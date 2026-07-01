#!/usr/bin/env python3
import argparse
import json
import math
import re
import subprocess
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

GHOSTWRITER_DB_CONTAINER = "ghostwriter-db-1"
TG_SEND = "/root/.codex/scripts/tg-send.sh"

ARTICLE_ACTIONS = {"new_blog_article", "support_article", "new_landing_page"}
CITY_HINTS = [
    "regensburg", "tegernheim", "pentling", "lappersdorf", "neutraubling", "obertraubling",
    "stuttgart", "nürnberg", "nuernberg", "münchen", "muenchen", "erlangen", "bayern",
    "oberpfalz",
]
STOPWORDS = {
    "und", "oder", "der", "die", "das", "ein", "eine", "einer", "eines", "mit", "von", "vom",
    "im", "in", "am", "an", "auf", "für", "fuer", "als", "bei", "nach", "aus", "zu", "zur",
    "zum", "ist", "sind", "wie", "was", "wer", "wo", "warum", "blog", "seite", "page", "de",
    "en", "www", "https", "http", "immobilien", "immobilie", "baur",
}
BRANDISH_HINTS = {
    "baur-immobilien": ["baur", "bauer immobilien", "baurimmobilien", "baur immobilien", "immobilien baur"],
}


def run(args, input_text=None, timeout=60, check=True):
    result = subprocess.run(
        args,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    return result.stdout.strip()


def sql_quote(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def psql_json(sql):
    out = run(
        ["docker", "exec", "-i", GHOSTWRITER_DB_CONTAINER, "psql", "-U", "ghostwriter", "-d", "ghostwriter", "-At", "-c", sql],
        timeout=90,
    )
    return json.loads(out or "[]")


def psql_exec(sql):
    return run(
        ["docker", "exec", "-i", GHOSTWRITER_DB_CONTAINER, "psql", "-U", "ghostwriter", "-d", "ghostwriter", "-v", "ON_ERROR_STOP=1", "-c", sql],
        timeout=120,
    )


def normalize_path(value):
    if not value:
        return "/"
    value = str(value).strip()
    if value.startswith("http"):
        value = urlparse(value).path or "/"
    value = re.sub(r"[?#].*$", "", value)
    if not value.startswith("/"):
        value = "/" + value
    value = re.sub(r"/+", "/", value)
    if value != "/" and not value.endswith("/"):
        value += "/"
    return value


def normalize_text(value):
    text = (value or "").lower()
    text = text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = re.sub(r"[^a-z0-9\s/-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slug_tokens(value):
    text = normalize_text(value)
    return [part for part in re.findall(r"[a-z0-9]{3,}", text) if part not in STOPWORDS]


def display_city(value):
    if not value:
        return None
    mapping = {"nuernberg": "Nürnberg", "muenchen": "München"}
    return mapping.get(value, value[:1].upper() + value[1:])


def extract_city(query, page):
    text = normalize_text(f"{query or ''} {page or ''}")
    for city in CITY_HINTS:
        city_norm = normalize_text(city)
        if city_norm in text:
            return display_city(city_norm)
    return None


def extract_theme(query, page):
    raw = query or page or "Immobilien"
    raw_norm = normalize_text(raw)
    replacements = [
        ("multi family property investment", "Mehrfamilienhaus Investment Deutschland"),
        ("immobilien markt", "Immobilienmarkt"),
        ("immobilienmarkt", "Immobilienmarkt"),
        ("immobilienentwicklung", "Immobilienentwicklung"),
        ("hauspreise", "Hauspreise"),
        ("immobilie verkaufen ohne makler", "Immobilie ohne Makler verkaufen"),
        ("kaufnebenkosten", "Kaufnebenkosten"),
    ]
    for needle, label in replacements:
        if needle in raw_norm:
            return label
    tokens = slug_tokens(raw)
    tokens = [t for t in tokens if t not in {normalize_text(c) for c in CITY_HINTS}]
    if not tokens:
        return "Immobilienthema"
    return " ".join(tokens[:5]).replace("ki ", "KI ").strip().title()


def is_brandish_homepage_signal(row, tenant):
    if normalize_path(row.get("page")) != "/":
        return False
    query = normalize_text(row.get("query") or row.get("topic") or "")
    tenant_slug = tenant.get("slug")
    hints = BRANDISH_HINTS.get(tenant_slug, [])
    return any(normalize_text(hint) in query for hint in hints)


def week_start_for_today():
    today = date.today()
    return today - timedelta(days=today.weekday())


def ensure_schema():
    psql_exec(
        """
        CREATE TABLE IF NOT EXISTS seo_weekly_content_candidates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          week_start date NOT NULL,
          slot integer NOT NULL,
          source_key text NOT NULL,
          status text NOT NULL DEFAULT 'brief_ready',
          title text NOT NULL,
          title_alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
          content_type text NOT NULL,
          recommendation text NOT NULL,
          city text,
          theme text,
          primary_query text,
          target_url text,
          score integer NOT NULL DEFAULT 0,
          reason text,
          existing_asset text,
          existing_asset_url text,
          cannibalization_risk text NOT NULL DEFAULT 'none',
          source_opportunity_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
          signal_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
          briefing jsonb NOT NULL DEFAULT '{}'::jsonb,
          internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
          cta_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
          social_package jsonb NOT NULL DEFAULT '{}'::jsonb,
          telegram_sent_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, week_start, slot),
          UNIQUE (tenant_id, week_start, source_key)
        );
        CREATE INDEX IF NOT EXISTS seo_weekly_content_candidates_tenant_week_idx
          ON seo_weekly_content_candidates (tenant_id, week_start DESC, slot);

        CREATE TABLE IF NOT EXISTS seo_weekly_content_scout_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          status text NOT NULL DEFAULT 'running',
          week_start date NOT NULL,
          tenants_checked integer NOT NULL DEFAULT 0,
          candidates_created integer NOT NULL DEFAULT 0,
          telegram_messages integer NOT NULL DEFAULT 0,
          message text
        );
        """
    )


def get_tenants(tenant_filter=None):
    filter_sql = ""
    if tenant_filter:
        filter_sql = f"AND (tenants.slug = {sql_quote(tenant_filter)} OR tenant_settings.analytics_tenant_key = {sql_quote(tenant_filter)} OR tenant_settings.project_key = {sql_quote(tenant_filter)})"
    return psql_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT tenants.id::text, tenants.name, tenants.slug, tenants.domain,
                 tenant_settings.project_key,
                 tenant_settings.analytics_tenant_key,
                 tenant_settings.gsc_site,
                 tenant_settings.client_api_url
          FROM tenants
          LEFT JOIN tenant_settings ON tenant_settings.tenant_id = tenants.id
          WHERE tenants.status = 'active'
          {filter_sql}
          ORDER BY tenants.name
        ) t;
        """
    )


def existing_candidate_count(tenant_id, week_start):
    rows = psql_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT slot, source_key
          FROM seo_weekly_content_candidates
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND week_start = {sql_quote(week_start)}
            AND status <> 'ignored'
          ORDER BY slot
        ) t;
        """
    )
    return rows


def load_opportunities(tenant_id, limit):
    return psql_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, query, page, topic,
                 COALESCE(content_action, recommendation) AS action,
                 recommendation, reason,
                 impressions, clicks, ctr, position,
                 analytics_visits, analytics_unique_visitors, analytics_conversions,
                 priority_score, matched_asset_type, matched_asset_title,
                 cannibalization_risk, reserved_slug_hit, protected_asset_type,
                 internal_link_targets, gap_analysis, updated_at
          FROM seo_signal_opportunities
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND status = 'open'
            AND COALESCE(content_action, recommendation) IN ('new_blog_article', 'support_article', 'new_landing_page')
            AND COALESCE(cannibalization_risk, 'none') <> 'high'
          ORDER BY priority_score DESC, impressions DESC, analytics_visits DESC, updated_at DESC
          LIMIT {int(limit)}
        ) t;
        """
    )


def cluster_key(row):
    city = extract_city(row.get("query"), row.get("page")) or "no-city"
    text = " ".join(slug_tokens(f"{row.get('query') or ''} {row.get('topic') or ''} {normalize_path(row.get('page'))}"))
    core = "-".join(text.split()[:4]) or normalize_path(row.get("page")).strip("/").replace("/", "-") or "topic"
    return f"{row.get('action')}|{city.lower()}|{core}"


def row_strength(row):
    impressions = int(row.get("impressions") or 0)
    clicks = int(row.get("clicks") or 0)
    visits = int(row.get("analytics_visits") or 0)
    score = int(row.get("priority_score") or 0)
    position = float(row.get("position") or 99)
    quickwin = 12 if 4 <= position <= 20 else 0
    return score + min(18, int(math.log1p(impressions) * 5)) + min(16, int(math.log1p(visits) * 4)) + clicks * 3 + quickwin


def aggregate_opportunities(rows):
    clusters = defaultdict(list)
    for row in rows:
        clusters[cluster_key(row)].append(row)

    aggregated = []
    for key, items in clusters.items():
        items = sorted(items, key=row_strength, reverse=True)
        lead = items[0]
        impressions = sum(int(item.get("impressions") or 0) for item in items)
        clicks = sum(int(item.get("clicks") or 0) for item in items)
        visits = sum(int(item.get("analytics_visits") or 0) for item in items)
        best_position = min([float(item.get("position") or 99) for item in items] or [99])
        score = min(100, row_strength(lead) + min(12, len(items) * 2))
        aggregated.append({
            "cluster_key": key,
            "lead": lead,
            "items": items[:8],
            "score": score,
            "impressions": impressions,
            "clicks": clicks,
            "visits": visits,
            "best_position": best_position if best_position != 99 else None,
        })
    return sorted(aggregated, key=lambda item: item["score"], reverse=True)


def tenant_origin(tenant):
    if tenant.get("analytics_tenant_key") == "baurimmo" or tenant.get("slug") == "baur-immobilien":
        return "https://immobilienbaur.de"
    domain = tenant.get("domain")
    if domain:
        return domain if domain.startswith("http") else f"https://{domain}"
    return ""


def absolute_url(tenant, path):
    path = normalize_path(path)
    origin = tenant_origin(tenant)
    return f"{origin}{path}" if origin else path


def make_title(tenant, action, city, theme, query):
    if tenant.get("analytics_tenant_key") == "baurimmo":
        if action == "support_article":
            base = f"{theme}: Was Käufer und Verkäufer wissen sollten"
            if city:
                base = f"{theme} in {city}: Was Käufer und Verkäufer wissen sollten"
        elif action == "new_landing_page":
            base = f"Immobilien in {city or 'der Region'}: {theme} richtig einordnen"
        else:
            base = f"{theme}: Praxisratgeber für Immobilienentscheidungen"
            if city:
                base = f"{theme} in {city}: Praxisratgeber für Immobilienentscheidungen"
    else:
        base = f"{theme}: Chancen, Fragen und nächster Schritt"
        if city:
            base = f"{theme} in {city}: Chancen, Fragen und nächster Schritt"
    query_part = (query or "").strip()
    alternatives = [
        f"{theme}: Die wichtigsten Fragen verständlich erklärt",
        f"{theme}: Worauf es jetzt wirklich ankommt",
        f"{query_part[:70]}: kompakter Überblick" if query_part else f"{theme}: kompakter Überblick",
    ]
    return base[:180], alternatives


def cta_plan_for(tenant, action, theme, city):
    key = tenant.get("analytics_tenant_key") or tenant.get("slug")
    if key == "baurimmo":
        return [
            {"position": "nach Einstieg", "label": "Kaufnebenkosten prüfen", "target": "/kaufnebenkosten-rechner/", "intent": "Rechner nutzen, wenn Kosten/Finanzierung berührt werden"},
            {"position": "nach erstem Praxisblock", "label": "Immobilie bewerten lassen", "target": "/immobilienbewertung/", "intent": "Verkäufer-Lead bei Marktwert/Preis-Fragen"},
            {"position": "nach regionalem Abschnitt", "label": "Suchprofil anlegen", "target": "/suchprofil/", "intent": "Käufer-Lead bei Stadt-/Objektinteresse"},
            {"position": "Artikelende", "label": "Beratung anfragen", "target": "/kontakt/", "intent": "Direkte Anfrage bei Beratungsbedarf"},
        ]
    return [
        {"position": "nach Einstieg", "label": "Analyse anfragen", "target": "/kontakt", "intent": "Kontakt-CTA"},
        {"position": "Mitte", "label": "Passenden Service prüfen", "target": "/", "intent": "Service-Verknüpfung"},
        {"position": "Artikelende", "label": "Projekt besprechen", "target": "/kontakt", "intent": "Lead-Abschluss"},
    ]


def build_briefing(tenant, aggregate):
    lead = aggregate["lead"]
    action = lead.get("action")
    city = extract_city(lead.get("query"), lead.get("page"))
    theme = extract_theme(lead.get("query") or lead.get("topic"), lead.get("page"))
    title, alternatives = make_title(tenant, action, city, theme, lead.get("query"))
    links = lead.get("internal_link_targets") if isinstance(lead.get("internal_link_targets"), list) else []
    ctas = cta_plan_for(tenant, action, theme, city)
    existing_asset_url = absolute_url(tenant, lead.get("page")) if lead.get("page") else None
    recommendation = {
        "new_blog_article": "Neuer Blogartikel",
        "support_article": "Support-Artikel",
        "new_landing_page": "Regionale Landingpage oder lokaler Ratgeber",
    }.get(action, action)
    why = (
        f"{aggregate['impressions']} GSC-Impressions, {aggregate['clicks']} Klicks, "
        f"{aggregate['visits']} Analytics-Visits, beste Position "
        f"{round(aggregate['best_position'], 1) if aggregate['best_position'] else 'n/a'}."
    )
    briefing = {
        "main_title": title,
        "title_alternatives": alternatives,
        "target_intent": f"Nutzer suchen nach {lead.get('query') or theme}; Ziel ist {recommendation.lower()} mit klarer Abgrenzung zum Bestand.",
        "why_now": why,
        "what_exists": lead.get("matched_asset_title") or lead.get("page") or "Kein klares Asset erkannt.",
        "content_gap": "Die Nachfrage ist sichtbar, aber noch nicht als eigenständiger, sauber vernetzter Content-Kandidat abgedeckt.",
        "guardrails": [
            "Keine Tool- oder Landingpage-Slugs kopieren.",
            "Bestehende Assets stärken und verlinken, nicht kannibalisieren.",
            "Social und GBP nur als Entwurf vorbereiten, nicht posten.",
        ],
        "recommended_internal_links": links[:5],
        "cta_plan": ctas,
        "research_task": f"Prüfe aktuelle Fakten, regionale Besonderheiten und bestehende Baurimmo-Seiten zu {theme}{' in ' + city if city else ''}. Keine Zahlen erfinden.",
        "social_angle": {
            "linkedin": f"Kurzer Experten-Post: Warum {theme}{' in ' + city if city else ''} gerade Suchinteresse zeigt.",
            "facebook": f"Lokaler Praxis-Hinweis zu {theme}{' in ' + city if city else ''} mit Beratungsangebot.",
            "instagram": f"Carousel-Idee: 3 Dinge, die man bei {theme} prüfen sollte.",
        },
        "gbp_idea": f"Kurzer Google-Business-Post zu {theme}{' in ' + city if city else ''}, nur vorbereiten.",
        "publish_risk": {
            "cannibalization": lead.get("cannibalization_risk") or "none",
            "existing_asset": lead.get("matched_asset_title"),
            "note": lead.get("reason"),
        },
        "recommendation": recommendation,
    }
    signal_summary = {
        "queries": [{"query": item.get("query"), "impressions": item.get("impressions"), "clicks": item.get("clicks"), "position": item.get("position")} for item in aggregate["items"]],
        "impressions": aggregate["impressions"],
        "clicks": aggregate["clicks"],
        "analytics_visits": aggregate["visits"],
        "best_position": aggregate["best_position"],
    }
    social_package = {
        "linkedin": briefing["social_angle"]["linkedin"],
        "facebook": briefing["social_angle"]["facebook"],
        "instagram": briefing["social_angle"]["instagram"],
        "gbp": briefing["gbp_idea"],
        "autopost_allowed": False,
    }
    return {
        "source_key": aggregate["cluster_key"],
        "title": title,
        "title_alternatives": alternatives,
        "content_type": action,
        "recommendation": recommendation,
        "city": city,
        "theme": theme,
        "primary_query": lead.get("query"),
        "target_url": absolute_url(tenant, lead.get("page")) if lead.get("page") else None,
        "score": int(aggregate["score"]),
        "reason": lead.get("reason"),
        "existing_asset": lead.get("matched_asset_title"),
        "existing_asset_url": existing_asset_url,
        "cannibalization_risk": lead.get("cannibalization_risk") or "none",
        "source_opportunity_ids": [item["id"] for item in aggregate["items"] if item.get("id")],
        "signal_summary": signal_summary,
        "briefing": briefing,
        "internal_links": links[:5],
        "cta_plan": ctas,
        "social_package": social_package,
    }


def insert_candidate(tenant_id, week_start, slot, candidate):
    ids = ",".join(f"{sql_quote(item)}::uuid" for item in candidate["source_opportunity_ids"])
    ids_expr = f"ARRAY[{ids}]::uuid[]" if ids else "ARRAY[]::uuid[]"
    psql_exec(
        f"""
        INSERT INTO seo_weekly_content_candidates (
          tenant_id, week_start, slot, source_key, status, title, title_alternatives,
          content_type, recommendation, city, theme, primary_query, target_url,
          score, reason, existing_asset, existing_asset_url, cannibalization_risk,
          source_opportunity_ids, signal_summary, briefing, internal_links, cta_plan, social_package,
          created_at, updated_at
        ) VALUES (
          {sql_quote(tenant_id)}::uuid,
          {sql_quote(week_start)}::date,
          {int(slot)},
          {sql_quote(candidate['source_key'])},
          'brief_ready',
          {sql_quote(candidate['title'])},
          {sql_quote(json.dumps(candidate['title_alternatives'], ensure_ascii=False))}::jsonb,
          {sql_quote(candidate['content_type'])},
          {sql_quote(candidate['recommendation'])},
          {sql_quote(candidate['city'])},
          {sql_quote(candidate['theme'])},
          {sql_quote(candidate['primary_query'])},
          {sql_quote(candidate['target_url'])},
          {int(candidate['score'])},
          {sql_quote(candidate['reason'])},
          {sql_quote(candidate['existing_asset'])},
          {sql_quote(candidate['existing_asset_url'])},
          {sql_quote(candidate['cannibalization_risk'])},
          {ids_expr},
          {sql_quote(json.dumps(candidate['signal_summary'], ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(candidate['briefing'], ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(candidate['internal_links'], ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(candidate['cta_plan'], ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(candidate['social_package'], ensure_ascii=False))}::jsonb,
          now(), now()
        )
        ON CONFLICT (tenant_id, week_start, source_key) DO UPDATE SET
          title = EXCLUDED.title,
          title_alternatives = EXCLUDED.title_alternatives,
          content_type = EXCLUDED.content_type,
          recommendation = EXCLUDED.recommendation,
          city = EXCLUDED.city,
          theme = EXCLUDED.theme,
          primary_query = EXCLUDED.primary_query,
          target_url = EXCLUDED.target_url,
          score = EXCLUDED.score,
          reason = EXCLUDED.reason,
          existing_asset = EXCLUDED.existing_asset,
          existing_asset_url = EXCLUDED.existing_asset_url,
          cannibalization_risk = EXCLUDED.cannibalization_risk,
          source_opportunity_ids = EXCLUDED.source_opportunity_ids,
          signal_summary = EXCLUDED.signal_summary,
          briefing = EXCLUDED.briefing,
          internal_links = EXCLUDED.internal_links,
          cta_plan = EXCLUDED.cta_plan,
          social_package = EXCLUDED.social_package,
          updated_at = now();
        """
    )


def telegram_topic(tenant):
    return tenant.get("project_key") or tenant.get("analytics_tenant_key") or tenant.get("slug") or "oc"


def send_telegram_summaries(week_start, dry_run=False):
    rows = psql_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT c.id::text, c.tenant_id::text, c.week_start, c.slot, c.title, c.recommendation,
                 c.score, c.primary_query, c.city, c.theme, c.target_url, c.cannibalization_risk,
                 c.signal_summary, c.cta_plan, c.social_package,
                 t.name AS tenant_name, t.slug AS tenant_slug,
                 ts.project_key, ts.analytics_tenant_key
          FROM seo_weekly_content_candidates c
          JOIN tenants t ON t.id = c.tenant_id
          LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
          WHERE c.week_start = {sql_quote(week_start)}::date
            AND c.telegram_sent_at IS NULL
            AND c.status = 'brief_ready'
          ORDER BY t.name, c.slot
        ) t;
        """
    )
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["tenant_id"]].append(row)

    sent = 0
    for _, items in grouped.items():
        tenant = items[0]
        topic = telegram_topic(tenant)
        lines = [
            f"SEO-Scout: 3 Artikel-Kandidaten für {tenant['tenant_name']}",
            f"Woche ab {week_start}",
            "",
        ]
        for item in items[:3]:
            summary = item.get("signal_summary") or {}
            lines.append(f"{item['slot']}. {item['title']}")
            lines.append(f"Typ: {item['recommendation']} · Score {item['score']}/100 · Risiko {item['cannibalization_risk']}")
            lines.append(f"Signal: {summary.get('impressions', 0)} Impr., {summary.get('clicks', 0)} Klicks, {summary.get('analytics_visits', 0)} Visits")
            lines.append(f"Query: {item.get('primary_query') or '-'}")
            if item.get("target_url"):
                lines.append(f"Asset/Seite: {item['target_url']}")
            lines.append("")
        lines.append("Social/GBP sind nur vorbereitet, nicht gepostet. Freigabe bleibt nötig.")
        lines.append("UI: https://ghostwriter.code-lederhos.de/admin/seo-content-scout")
        message = "\n".join(lines)
        if not dry_run:
            run([TG_SEND, topic, message, "html"], timeout=25, check=False)
            ids = ",".join(sql_quote(item["id"]) for item in items)
            psql_exec(f"UPDATE seo_weekly_content_candidates SET telegram_sent_at = now(), updated_at = now() WHERE id IN ({ids});")
        sent += 1
    return sent


def record_run(status, week_start, tenants_checked, created, telegram_messages, message=""):
    psql_exec(
        f"""
        INSERT INTO seo_weekly_content_scout_runs (
          finished_at, status, week_start, tenants_checked, candidates_created, telegram_messages, message
        ) VALUES (
          now(), {sql_quote(status)}, {sql_quote(week_start)}::date, {int(tenants_checked)}, {int(created)},
          {int(telegram_messages)}, {sql_quote((message or '')[:900])}
        );
        """
    )


def main():
    parser = argparse.ArgumentParser(description="Create weekly SEO content candidates from tenant-wide GSC and Analytics opportunities.")
    parser.add_argument("--tenant", help="tenant slug, project key, or analytics tenant key")
    parser.add_argument("--weekly-budget", type=int, default=3)
    parser.add_argument("--limit", type=int, default=180)
    parser.add_argument("--send-telegram", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    ensure_schema()
    week_start = week_start_for_today().isoformat()
    tenants = get_tenants(args.tenant)
    tenants_checked = 0
    created = 0

    try:
        for tenant in tenants:
            tenants_checked += 1
            existing = existing_candidate_count(tenant["id"], week_start)
            used_slots = {int(row["slot"]) for row in existing}
            existing_keys = {row["source_key"] for row in existing}
            remaining = max(0, args.weekly_budget - len(existing)) if not args.force else args.weekly_budget
            if remaining <= 0:
                continue
            rows = [
                row for row in load_opportunities(tenant["id"], args.limit)
                if not is_brandish_homepage_signal(row, tenant)
            ]
            aggregates = aggregate_opportunities(rows)
            slot = 1
            for aggregate in aggregates:
                if aggregate["cluster_key"] in existing_keys and not args.force:
                    continue
                while slot in used_slots:
                    slot += 1
                if slot > args.weekly_budget:
                    break
                candidate = build_briefing(tenant, aggregate)
                if args.dry_run:
                    print(json.dumps({"tenant": tenant["slug"], "slot": slot, **candidate}, ensure_ascii=False, default=str))
                else:
                    insert_candidate(tenant["id"], week_start, slot, candidate)
                used_slots.add(slot)
                existing_keys.add(aggregate["cluster_key"])
                created += 1
                remaining -= 1
                if remaining <= 0:
                    break
        telegram_messages = send_telegram_summaries(week_start, dry_run=args.dry_run) if args.send_telegram else 0
        if not args.dry_run:
            record_run("success", week_start, tenants_checked, created, telegram_messages)
        print(json.dumps({
            "status": "success",
            "week_start": week_start,
            "tenants_checked": tenants_checked,
            "candidates_created": created,
            "telegram_messages": telegram_messages,
        }, ensure_ascii=False))
    except Exception as exc:
        if not args.dry_run:
            record_run("failed", week_start, tenants_checked, created, 0, str(exc))
        raise


if __name__ == "__main__":
    main()
