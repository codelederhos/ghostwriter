#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse

GHOSTWRITER_DB_CONTAINER = "ghostwriter-db-1"
BAURIMMO_DB_CONTAINER = "baurimmo-next-db"

BAURIMMO_PROTECTED_ASSETS = [
    {
        "asset_type": "tool",
        "source": "protected_route",
        "title": "Kaufnebenkosten-Rechner",
        "path": "/kaufnebenkosten-rechner/",
        "keywords": ["kaufnebenkosten", "kauf nebenkosten", "grundbuch", "notar", "grunderwerbsteuer", "maklerprovision", "rechner", "berechnen"],
    },
    {
        "asset_type": "tool",
        "source": "protected_route",
        "title": "Notarkosten-Rechner",
        "path": "/notarkosten-rechner/",
        "keywords": ["notarkosten", "notar", "grundbuchkosten", "beurkundung", "rechner"],
    },
    {
        "asset_type": "tool",
        "source": "protected_route",
        "title": "Renditerechner",
        "path": "/renditerechner/",
        "keywords": ["rendite", "renditerechner", "kapitalanlage", "investment", "cashflow", "rechner"],
    },
    {
        "asset_type": "tool",
        "source": "protected_route",
        "title": "Mietspiegel",
        "path": "/mietspiegel/",
        "keywords": ["mietspiegel", "miete", "vergleichsmiete"],
    },
    {
        "asset_type": "landing_page",
        "source": "protected_route",
        "title": "Immobilienmarkt",
        "path": "/immobilienmarkt/",
        "keywords": ["immobilienmarkt", "marktbericht", "marktanalyse", "preise", "preisentwicklung"],
    },
    {
        "asset_type": "landing_page",
        "source": "protected_route",
        "title": "Offmarket",
        "path": "/offmarket/",
        "keywords": ["offmarket", "diskret", "nicht öffentlich", "exklusiv"],
    },
    {
        "asset_type": "conversion",
        "source": "protected_route",
        "title": "Suchprofil",
        "path": "/suchprofil/",
        "keywords": ["suchprofil", "immobilie suchen", "suchauftrag", "kaufinteressent"],
    },
    {
        "asset_type": "conversion",
        "source": "protected_route",
        "title": "Bewerben",
        "path": "/bewerben/",
        "keywords": ["bewerben", "karriere", "makler werden", "job"],
    },
    {
        "asset_type": "tool",
        "source": "protected_route",
        "title": "Sofort-Ankauf-Check",
        "path": "/sofort-ankauf-check/",
        "keywords": ["sofort ankauf", "sofortankauf", "ankauf", "verkaufen schnell", "check"],
    },
]

BAURIMMO_FALLBACK_LINKS = [
    {"title": "Immobilienbewertung", "path": "/immobilienbewertung/", "asset_type": "conversion", "reason": "Bewertungs-CTA"},
    {"title": "Kontakt", "path": "/kontakt/", "asset_type": "conversion", "reason": "Kontakt-CTA"},
    {"title": "Suchprofil", "path": "/suchprofil/", "asset_type": "conversion", "reason": "Käufer-CTA"},
]

BRAND_HINTS = {
    "baur-immobilien": ["baur", "baur immobilien", "immobilien baur", "eduard rups"],
    "code-lederhos": ["code lederhos", "lederhos", "stani", "stanislaw lederhos"],
    "gabriela": ["gabriela lederhos", "gaby lederhos", "gabriela fotografie"],
    "staned": ["staned", "staned gmbh"],
}

REGIONAL_HINTS = [
    "regensburg", "stuttgart", "nuernberg", "nürnberg", "muenchen", "münchen",
    "erlangen", "tegernheim", "bayern", "deutschland", "germany", "oberpfalz",
]

STOPWORDS = {
    "und", "oder", "der", "die", "das", "ein", "eine", "einer", "eines", "mit", "von", "im", "in", "am", "an",
    "auf", "fuer", "für", "als", "bei", "nach", "aus", "zu", "zur", "zum", "ist", "sind", "wie", "was", "wer",
    "wo", "warum", "the", "and", "for", "with", "near", "de", "en", "blog", "seite", "page",
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


def psql_json(container, user, database, sql):
    out = run(["docker", "exec", "-i", container, "psql", "-U", user, "-d", database, "-At", "-c", sql], timeout=90)
    return json.loads(out or "[]")


def psql_exec(container, user, database, sql):
    return run(["docker", "exec", "-i", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=120)


def ghostwriter_json(sql):
    return psql_json(GHOSTWRITER_DB_CONTAINER, "ghostwriter", "ghostwriter", sql)


def ghostwriter_exec(sql):
    return psql_exec(GHOSTWRITER_DB_CONTAINER, "ghostwriter", "ghostwriter", sql)


def baurimmo_json(sql):
    return psql_json(BAURIMMO_DB_CONTAINER, "baurimmo", "baurimmo", sql)


def normalize_path(value):
    if not value:
        return "/"
    value = str(value).strip()
    if value.startswith("http"):
        parsed = urlparse(value)
        value = parsed.path or "/"
    value = re.sub(r"[?#].*$", "", value)
    if not value.startswith("/"):
        value = "/" + value
    value = re.sub(r"/+", "/", value)
    if value != "/" and not value.endswith("/"):
        value += "/"
    return value


def slugify(value):
    value = (value or "").lower()
    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:90]


def tokens(value):
    value = (value or "").lower()
    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    parts = re.findall(r"[a-z0-9]{3,}", value)
    return {part for part in parts if part not in STOPWORDS}


def text_for_asset(asset):
    return " ".join(str(asset.get(key) or "") for key in ("title", "path", "slug", "primary_keyword"))


def similarity(left, right):
    a = tokens(left)
    b = tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / max(1, min(len(a), len(b)))


def keyword_hit(text, keywords):
    haystack = (text or "").lower()
    normalized = haystack.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    for keyword in keywords:
        k = keyword.lower()
        k_norm = k.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
        if k in haystack or k_norm in normalized:
            return True
    return False


def ensure_schema():
    ghostwriter_exec(
        """
        ALTER TABLE seo_signal_opportunities
          ADD COLUMN IF NOT EXISTS content_action text,
          ADD COLUMN IF NOT EXISTS cannibalization_risk text NOT NULL DEFAULT 'none',
          ADD COLUMN IF NOT EXISTS reserved_slug_hit boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS protected_asset_type text,
          ADD COLUMN IF NOT EXISTS internal_link_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS gap_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS content_gap_checked_at timestamptz;

        CREATE TABLE IF NOT EXISTS content_gap_engine_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          status text NOT NULL DEFAULT 'running',
          tenants_checked integer NOT NULL DEFAULT 0,
          opportunities_checked integer NOT NULL DEFAULT 0,
          protected_hits integer NOT NULL DEFAULT 0,
          high_risk_hits integer NOT NULL DEFAULT 0,
          message text
        );
        CREATE INDEX IF NOT EXISTS seo_signal_opportunities_content_gap_idx
          ON seo_signal_opportunities (content_action, cannibalization_risk, priority_score DESC);
        """
    )


def get_tenants():
    return ghostwriter_json(
        """
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT tenants.id::text, tenants.name, tenants.slug, tenants.domain,
                 tenant_settings.project_key,
                 tenant_settings.analytics_tenant_key,
                 tenant_settings.gsc_site
          FROM tenants
          LEFT JOIN tenant_settings ON tenant_settings.tenant_id = tenants.id
          WHERE tenants.status = 'active'
          ORDER BY tenants.name
        ) t;
        """
    )


def load_ghostwriter_assets(tenant_id):
    return ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, 'ghostwriter_post' AS source, 'blog' AS asset_type,
                 blog_title AS title, blog_slug AS slug,
                 blog_primary_keyword AS primary_keyword,
                 COALESCE(blog_url, '/blog/' || blog_slug || '/') AS path
          FROM ghostwriter_posts
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND blog_slug IS NOT NULL
          UNION ALL
          SELECT id::text, 'seo_hub' AS source, 'landing_page' AS asset_type,
                 title, slug, NULL::text AS primary_keyword, '/' || slug || '/' AS path
          FROM seo_pages
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND slug IS NOT NULL
            AND COALESCE(status, 'draft') <> 'archived'
        ) t;
        """
    )


def load_baurimmo_assets():
    try:
        rows = baurimmo_json(
            """
            SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
            FROM (
              SELECT id::text, 'baurimmo_blog' AS source, 'blog' AS asset_type,
                     title, slug, primary_keyword,
                     '/blog/' || slug || '/' AS path
              FROM blog_posts
              WHERE slug IS NOT NULL
            ) t;
            """
        )
    except Exception as exc:
        print(f"warning: baurimmo blog inventory unavailable: {exc}")
        rows = []
    return rows


def with_normalized_assets(assets):
    normalized = []
    seen = set()
    for asset in assets:
        path = normalize_path(asset.get("path"))
        key = (asset.get("asset_type"), path, asset.get("title"))
        if key in seen:
            continue
        seen.add(key)
        item = dict(asset)
        item["path"] = path
        item["slug"] = item.get("slug") or slugify(path.strip("/").split("/")[-1])
        item["asset_text"] = text_for_asset(item)
        normalized.append(item)
    return normalized


def normalize_tenant_asset_paths(tenant, assets):
    if tenant.get("slug") != "baur-immobilien":
        return assets
    normalized = []
    for asset in assets:
        item = dict(asset)
        path = normalize_path(item.get("path"))
        match = re.match(r"^/baur-immobilien/(de|en)/blog/([^/]+)/$", path)
        if match:
            item["path"] = f"/blog/{match.group(2)}/"
            item["slug"] = item.get("slug") or match.group(2)
        else:
            item["path"] = path
        normalized.append(item)
    return normalized


def build_inventory(tenant):
    assets = load_ghostwriter_assets(tenant["id"])
    if tenant.get("slug") == "baur-immobilien":
        assets.extend(BAURIMMO_PROTECTED_ASSETS)
        assets.extend(load_baurimmo_assets())
        existing_paths = {normalize_path(asset.get("path")) for asset in assets}
        for link in BAURIMMO_FALLBACK_LINKS:
            if normalize_path(link["path"]) not in existing_paths:
                assets.append({"source": "fallback_route", "title": link["title"], "path": link["path"], "asset_type": link["asset_type"], "keywords": []})
    return with_normalized_assets(normalize_tenant_asset_paths(tenant, assets))


def load_opportunities(tenant_id, limit):
    return ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, query, page, topic, opportunity_type, recommendation, reason,
                 impressions, clicks, ctr, position, analytics_visits, priority_score,
                 matched_asset_type, matched_asset_title, status
          FROM seo_signal_opportunities
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND status IN ('open', 'in_progress')
          ORDER BY priority_score DESC, impressions DESC, updated_at DESC
          LIMIT {int(limit)}
        ) t;
        """
    )


def find_path_asset(assets, path):
    path = normalize_path(path)
    for asset in assets:
        if normalize_path(asset.get("path")) == path:
            return asset
    return None


def find_protected_asset(tenant_slug, assets, query, page):
    if tenant_slug != "baur-immobilien":
        return None, False
    page = normalize_path(page)
    text = f"{query or ''} {page or ''}"
    for asset in assets:
        if asset.get("source") != "protected_route":
            continue
        if normalize_path(asset.get("path")) == page:
            return asset, True
        if keyword_hit(text, asset.get("keywords") or []):
            return asset, False
    return None, False


def best_similar_asset(assets, query, page, exclude_path=None):
    topic_text = f"{query or ''} {page or ''}"
    best = None
    best_score = 0.0
    for asset in assets:
        if exclude_path and normalize_path(asset.get("path")) == normalize_path(exclude_path):
            continue
        score = similarity(topic_text, asset.get("asset_text") or text_for_asset(asset))
        if score > best_score:
            best = asset
            best_score = score
    return best, best_score


def has_brand_intent(tenant_slug, query):
    q = (query or "").lower()
    return any(hint in q for hint in BRAND_HINTS.get(tenant_slug, []))


def has_regional_intent(query, page):
    text = f"{query or ''} {page or ''}".lower()
    return any(hint in text for hint in REGIONAL_HINTS)


def is_low_signal(row):
    return int(row.get("impressions") or 0) <= 2 and int(row.get("clicks") or 0) == 0 and int(row.get("priority_score") or 0) < 20


def link_object(asset, reason):
    return {
        "title": asset.get("title") or asset.get("path") or "Asset",
        "path": normalize_path(asset.get("path")),
        "asset_type": asset.get("asset_type") or "asset",
        "reason": reason,
    }


def pick_internal_links(tenant_slug, assets, protected_asset, exact_asset, similar_asset, query, page):
    links = []
    seen = set()
    protected_slugs = {
        slugify(asset.get("path", "").strip("/").split("/")[-1])
        for asset in assets
        if asset.get("source") == "protected_route"
    }

    def add(asset, reason):
        if not asset:
            return
        asset_slug = slugify(asset.get("slug") or asset.get("path", "").strip("/").split("/")[-1])
        if tenant_slug == "baur-immobilien" and asset.get("asset_type") == "blog" and asset_slug in protected_slugs:
            return
        obj = link_object(asset, reason)
        if obj["path"] in seen:
            return
        seen.add(obj["path"])
        links.append(obj)

    add(protected_asset, "Geschütztes Hauptasset stärken")
    add(exact_asset, "Bestehendes Asset aktualisieren")
    add(similar_asset, "Thematisch nahes Asset vernetzen")

    query_text = f"{query or ''} {page or ''}"
    ranked = []
    for asset in assets:
        if normalize_path(asset.get("path")) in seen:
            continue
        score = similarity(query_text, asset.get("asset_text") or text_for_asset(asset))
        if score > 0:
            ranked.append((score, asset))
    for _, asset in sorted(ranked, key=lambda pair: pair[0], reverse=True)[:4]:
            add(asset, "Passende interne Vernetzung")

    if tenant_slug == "baur-immobilien":
        for fallback in BAURIMMO_FALLBACK_LINKS:
            add(fallback, fallback["reason"])
            if len(links) >= 5:
                break
    return links[:5]


def classify(row, tenant, assets):
    tenant_slug = tenant.get("slug")
    page = normalize_path(row.get("page"))
    query = row.get("query") or row.get("topic") or ""
    candidate_slug = slugify(query or page)
    exact_asset = find_path_asset(assets, page)
    protected_asset, exact_protected_path = find_protected_asset(tenant_slug, assets, query, page)
    similar_asset, similar_score = best_similar_asset(assets, query, page, exclude_path=page)

    reserved_slugs = {slugify(asset.get("path", "").strip("/").split("/")[-1]) for asset in assets if asset.get("source") == "protected_route"}
    existing_blog_slugs = {slugify(asset.get("slug") or asset.get("path", "").strip("/").split("/")[-1]) for asset in assets if asset.get("asset_type") == "blog"}
    candidate_hits_reserved = candidate_slug in reserved_slugs or f"{candidate_slug}-rechner" in reserved_slugs
    candidate_hits_blog = candidate_slug in existing_blog_slugs

    action = row.get("recommendation") or "new_blog_article"
    risk = "none"
    protected_type = None
    reasons = []
    matched_title = row.get("matched_asset_title")
    matched_type = row.get("matched_asset_type")

    if has_brand_intent(tenant_slug, query):
        action = "refresh_existing_page"
        risk = "low"
        reasons.append("Brand- oder Local-Intent gehört auf bestehende Marken-/Startseite, nicht in einen Blogartikel.")
    elif protected_asset:
        protected_type = protected_asset.get("asset_type")
        matched_title = protected_asset.get("title")
        matched_type = protected_asset.get("asset_type")
        risk = "high" if exact_protected_path or candidate_hits_reserved else "medium"
        if exact_protected_path or "rechner" in (query or "").lower() or candidate_hits_reserved:
            action = "refresh_existing_page"
            reasons.append(f"{protected_asset.get('title')} ist ein geschütztes Hauptasset und darf nicht als Blog-Hauptslug kopiert werden.")
        else:
            action = "support_article"
            reasons.append(f"Thema berührt {protected_asset.get('title')}; sinnvoll ist ergänzender Support-Content mit Link auf die Tool-/Landingpage.")
    elif candidate_hits_blog:
        action = "ignore_duplicate"
        risk = "high"
        reasons.append("Ein sehr naher Blog-Slug existiert bereits; neuer Artikel würde duplizieren.")
    elif exact_asset:
        matched_title = exact_asset.get("title")
        matched_type = exact_asset.get("asset_type")
        action = "refresh_existing_page"
        risk = "low"
        reasons.append("Signal liegt auf einem bestehenden Asset; zuerst Inhalt, Title, Meta und interne Links verbessern.")
    elif similar_asset and similar_score >= 0.72:
        matched_title = similar_asset.get("title")
        matched_type = similar_asset.get("asset_type")
        action = "refresh_existing_page"
        risk = "medium"
        reasons.append(f"Sehr nahes bestehendes Asset gefunden ({matched_title}); erst dort ausbauen statt neues Thema zu splitten.")
    elif similar_asset and similar_score >= 0.5:
        matched_title = similar_asset.get("title")
        matched_type = similar_asset.get("asset_type")
        action = "support_article"
        risk = "low"
        reasons.append(f"Thema ist verwandt mit {matched_title}; neuer Content nur mit klarer Abgrenzung und internem Link.")
    elif has_regional_intent(query, page):
        action = "new_landing_page"
        risk = "low"
        reasons.append("Regionaler Intent ohne klares Asset: eher Landingpage oder lokaler Ratgeber als allgemeiner Blog.")
    elif is_low_signal(row):
        action = "social_only"
        risk = "none"
        reasons.append("Suchsignal ist noch schwach; als Social- oder GBP-Idee merken, nicht direkt SEO-Artikel bauen.")
    else:
        action = "new_blog_article"
        risk = "low"
        reasons.append("Kein passendes Asset und kein Tool-Konflikt gefunden; eigenständiger Blogartikel ist möglich.")

    links = pick_internal_links(tenant_slug, assets, protected_asset, exact_asset, similar_asset, query, page)
    if action in ("new_blog_article", "support_article") and not links:
        reasons.append("Vor Erstellung interne Links manuell festlegen.")

    analysis = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "candidate_slug": candidate_slug,
        "exact_asset_path": normalize_path(exact_asset.get("path")) if exact_asset else None,
        "protected_asset_path": normalize_path(protected_asset.get("path")) if protected_asset else None,
        "similar_asset_path": normalize_path(similar_asset.get("path")) if similar_asset else None,
        "similarity": round(similar_score, 3),
        "reserved_slug_hit": bool(protected_asset or candidate_hits_reserved),
        "duplicate_blog_slug": bool(candidate_hits_blog),
        "guardrails": [
            "Keinen geschützten Tool- oder Landingpage-Slug als Blog-Hauptslug verwenden.",
            "Bestehende starke Seiten zuerst refreshen oder mit Support-Content stärken.",
            "Interne Links müssen auf die echte Tenant-Domain zeigen.",
        ],
    }

    return {
        "action": action,
        "risk": risk,
        "reserved_slug_hit": bool(protected_asset or candidate_hits_reserved),
        "protected_asset_type": protected_type,
        "matched_asset_type": matched_type,
        "matched_asset_title": matched_title,
        "reason": " ".join(reasons),
        "links": links,
        "analysis": analysis,
    }


def update_opportunity(row_id, result):
    ghostwriter_exec(
        f"""
        UPDATE seo_signal_opportunities
        SET content_action = {sql_quote(result['action'])},
            recommendation = {sql_quote(result['action'])},
            cannibalization_risk = {sql_quote(result['risk'])},
            reserved_slug_hit = {'true' if result['reserved_slug_hit'] else 'false'},
            protected_asset_type = {sql_quote(result['protected_asset_type'])},
            matched_asset_type = {sql_quote(result['matched_asset_type'])},
            matched_asset_title = {sql_quote(result['matched_asset_title'])},
            reason = {sql_quote(result['reason'])},
            internal_link_targets = {sql_quote(json.dumps(result['links'], ensure_ascii=False))}::jsonb,
            gap_analysis = {sql_quote(json.dumps(result['analysis'], ensure_ascii=False))}::jsonb,
            content_gap_checked_at = now(),
            updated_at = now()
        WHERE id = {sql_quote(row_id)}::uuid;
        """
    )


def record_run(status, tenants_checked, opportunities_checked, protected_hits, high_risk_hits, message=None):
    ghostwriter_exec(
        f"""
        INSERT INTO content_gap_engine_runs (
          finished_at, status, tenants_checked, opportunities_checked, protected_hits, high_risk_hits, message
        ) VALUES (
          now(), {sql_quote(status)}, {int(tenants_checked)}, {int(opportunities_checked)},
          {int(protected_hits)}, {int(high_risk_hits)}, {sql_quote(message)}
        );
        """
    )


def main():
    parser = argparse.ArgumentParser(description="Classify SEO opportunities against content inventory and protected assets.")
    parser.add_argument("--tenant", help="Limit to tenant slug")
    parser.add_argument("--limit", type=int, default=300)
    args = parser.parse_args()

    ensure_schema()
    tenants = get_tenants()
    if args.tenant:
        tenants = [tenant for tenant in tenants if tenant.get("slug") == args.tenant]

    tenants_checked = 0
    opportunities_checked = 0
    protected_hits = 0
    high_risk_hits = 0

    try:
        for tenant in tenants:
            assets = build_inventory(tenant)
            opportunities = load_opportunities(tenant["id"], args.limit)
            tenants_checked += 1
            for row in opportunities:
                result = classify(row, tenant, assets)
                update_opportunity(row["id"], result)
                opportunities_checked += 1
                protected_hits += 1 if result["reserved_slug_hit"] else 0
                high_risk_hits += 1 if result["risk"] == "high" else 0
        record_run("success", tenants_checked, opportunities_checked, protected_hits, high_risk_hits)
        print(json.dumps({
            "status": "success",
            "tenants_checked": tenants_checked,
            "opportunities_checked": opportunities_checked,
            "protected_hits": protected_hits,
            "high_risk_hits": high_risk_hits,
        }, ensure_ascii=False))
    except Exception as exc:
        record_run("failed", tenants_checked, opportunities_checked, protected_hits, high_risk_hits, str(exc)[:500])
        raise


if __name__ == "__main__":
    main()
