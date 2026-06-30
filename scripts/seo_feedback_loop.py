#!/usr/bin/env python3
import argparse
import json
import re
import sqlite3
import subprocess
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

GHOSTWRITER_DB_CONTAINER = "ghostwriter-db-1"
BAURIMMO_DB_CONTAINER = "baurimmo-next-db"
GSC_DB = "/opt/analytics-reports/gsc_history.db"
TG_SEND = "/root/.codex/scripts/tg-send.sh"

MILESTONES = (7, 14, 30)


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


def asset_path_for_post(tenant, post):
    if tenant.get("slug") == "baur-immobilien" or tenant.get("analytics_tenant_key") == "baurimmo":
        slug = public_slug(post.get("blog_slug"))
        return normalize_path(f"/blog/{slug}/")
    return normalize_path(post.get("blog_url") or f"/blog/{post['blog_slug']}/")


def public_slug(value):
    slug = str(value or "").strip("/")
    if "/blog/" in slug:
        slug = slug.split("/blog/")[-1].strip("/")
    if "/" in slug:
        slug = slug.split("/")[-1]
    return slug


def parse_pg_timestamp(value):
    text = str(value or "").replace("Z", "+00:00")
    if "." in text:
        head, tail = text.split(".", 1)
        tz = ""
        if "+" in tail:
            frac, tz = tail.split("+", 1)
            tz = "+" + tz
        elif "-" in tail:
            frac, tz = tail.split("-", 1)
            tz = "-" + tz
        else:
            frac = tail
        frac = re.sub(r"[^0-9]", "", frac)[:6].ljust(6, "0")
        text = f"{head}.{frac}{tz}"
    return datetime.fromisoformat(text)


def tokens(value):
    text = (value or "").lower()
    text = text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return {part for part in re.findall(r"[a-z0-9]{4,}", text) if part not in {"blog", "seite", "fuer", "the", "und", "oder", "mit"}}


def ensure_schema():
    ghostwriter_exec(
        """
        CREATE TABLE IF NOT EXISTS seo_asset_feedback (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          post_id uuid REFERENCES ghostwriter_posts(id) ON DELETE SET NULL,
          asset_type text NOT NULL DEFAULT 'blog_post',
          asset_path text NOT NULL,
          asset_title text NOT NULL,
          milestone_days integer NOT NULL,
          published_at timestamptz,
          evaluated_at timestamptz NOT NULL DEFAULT now(),
          gsc_clicks_before integer NOT NULL DEFAULT 0,
          gsc_clicks_after integer NOT NULL DEFAULT 0,
          gsc_impressions_before integer NOT NULL DEFAULT 0,
          gsc_impressions_after integer NOT NULL DEFAULT 0,
          gsc_position_before numeric(8,2),
          gsc_position_after numeric(8,2),
          analytics_visits_before integer NOT NULL DEFAULT 0,
          analytics_visits_after integer NOT NULL DEFAULT 0,
          ranking_delta numeric(8,2),
          traffic_delta integer NOT NULL DEFAULT 0,
          status text NOT NULL,
          summary text,
          top_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
          internal_link_opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
          refresh_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
          social_gbp_suggestions jsonb NOT NULL DEFAULT '{}'::jsonb,
          source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          telegram_sent_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, post_id, milestone_days)
        );

        CREATE TABLE IF NOT EXISTS seo_feedback_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          status text NOT NULL DEFAULT 'running',
          tenants_checked integer NOT NULL DEFAULT 0,
          assets_checked integer NOT NULL DEFAULT 0,
          feedback_upserted integer NOT NULL DEFAULT 0,
          telegram_messages integer NOT NULL DEFAULT 0,
          message text
        );
        CREATE INDEX IF NOT EXISTS seo_asset_feedback_tenant_eval_idx
          ON seo_asset_feedback (tenant_id, evaluated_at DESC, milestone_days);
        CREATE INDEX IF NOT EXISTS seo_asset_feedback_status_idx
          ON seo_asset_feedback (status, evaluated_at DESC);
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
                 tenant_settings.gsc_site,
                 tenant_settings.client_api_url
          FROM tenants
          JOIN tenant_settings ON tenant_settings.tenant_id = tenants.id
          WHERE tenants.status = 'active'
            AND tenant_settings.gsc_site IS NOT NULL
          ORDER BY tenants.name
        ) t;
        """
    )


def get_published_posts(tenant_id, limit):
    return ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, blog_title, blog_slug, blog_primary_keyword, category,
                 language, blog_url, published_at, created_at
          FROM ghostwriter_posts
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND status = 'published'
            AND blog_slug IS NOT NULL
            AND published_at IS NOT NULL
          ORDER BY published_at DESC
          LIMIT {int(limit)}
        ) t;
        """
    )


def baurimmo_published_slugs():
    try:
        rows = baurimmo_json(
            """
            SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
            FROM (
              SELECT slug FROM blog_posts
              WHERE is_published = true
                AND slug IS NOT NULL
            ) t;
            """
        )
        return {public_slug(row.get("slug")) for row in rows}
    except Exception:
        return set()


def filter_public_posts(tenant, posts):
    if tenant.get("analytics_tenant_key") != "baurimmo" and tenant.get("slug") != "baur-immobilien":
        return posts
    public_slugs = baurimmo_published_slugs()
    if not public_slugs:
        return posts
    return [post for post in posts if public_slug(post.get("blog_slug")) in public_slugs]


def prune_stale_feedback(tenant, posts):
    if tenant.get("analytics_tenant_key") != "baurimmo" and tenant.get("slug") != "baur-immobilien":
        return
    ids = [post["id"] for post in posts if post.get("id")]
    if not ids:
        return
    id_sql = ",".join(f"{sql_quote(post_id)}::uuid" for post_id in ids)
    ghostwriter_exec(
        f"""
        DELETE FROM seo_asset_feedback
        WHERE tenant_id = {sql_quote(tenant['id'])}::uuid
          AND post_id IS NOT NULL
          AND post_id NOT IN ({id_sql});
        """
    )


def gsc_metrics(site, path, start_date, end_date):
    con = sqlite3.connect(GSC_DB)
    con.row_factory = sqlite3.Row
    row = con.execute(
        """
        SELECT COALESCE(SUM(clicks), 0) AS clicks,
               COALESCE(SUM(impressions), 0) AS impressions,
               AVG(position) AS position,
               AVG(ctr) AS ctr
        FROM gsc_keyword_history
        WHERE site = ?
          AND page = ?
          AND date >= ?
          AND date <= ?
        """,
        (site, path, start_date.isoformat(), end_date.isoformat()),
    ).fetchone()
    rows = con.execute(
        """
        SELECT query,
               COALESCE(SUM(clicks), 0) AS clicks,
               COALESCE(SUM(impressions), 0) AS impressions,
               AVG(position) AS position
        FROM gsc_keyword_history
        WHERE site = ?
          AND page = ?
          AND date >= ?
          AND date <= ?
        GROUP BY query
        HAVING SUM(impressions) > 0
        ORDER BY SUM(impressions) DESC, AVG(position) ASC
        LIMIT 8
        """,
        (site, path, start_date.isoformat(), end_date.isoformat()),
    ).fetchall()
    con.close()
    return dict(row), [dict(item) for item in rows]


def baurimmo_visits(path, start_dt, end_dt):
    return baurimmo_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT COUNT(*)::int AS visits,
                 COUNT(DISTINCT COALESCE(visitor_id, session_id, ip_hash))::int AS unique_visitors
          FROM analytics_events
          WHERE event_type = 'pageview'
            AND is_bot = false
            AND is_test = false
            AND COALESCE(path, '/') = {sql_quote(path)}
            AND created_at >= {sql_quote(start_dt.isoformat())}::timestamptz
            AND created_at < {sql_quote((end_dt + timedelta(days=1)).isoformat())}::timestamptz
        ) t;
        """
    )[0]


def analytics_metrics(tenant, path, start_date, end_date):
    if tenant.get("analytics_tenant_key") == "baurimmo":
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc)
        row = baurimmo_visits(path, start_dt, end_dt)
        return {"visits": int(row.get("visits") or 0), "unique_visitors": int(row.get("unique_visitors") or 0), "available": True}
    return {"visits": 0, "unique_visitors": 0, "available": False}


def related_internal_links(tenant_id, post, path, top_queries):
    query_text = " ".join([post.get("blog_title") or "", post.get("blog_primary_keyword") or "", " ".join(q.get("query") or "" for q in top_queries)])
    q_tokens = tokens(query_text)
    rows = ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, blog_title, blog_slug, blog_primary_keyword, category, language,
                 '/blog/' || blog_slug || '/' AS path
          FROM ghostwriter_posts
          WHERE tenant_id = {sql_quote(tenant_id)}::uuid
            AND status = 'published'
            AND id <> {sql_quote(post['id'])}::uuid
            AND blog_slug IS NOT NULL
          ORDER BY published_at DESC
          LIMIT 80
        ) t;
        """
    )
    scored = []
    for row in rows:
        overlap = q_tokens & tokens(" ".join([row.get("blog_title") or "", row.get("blog_primary_keyword") or "", row.get("category") or ""]))
        if overlap:
            scored.append((len(overlap), row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "title": row.get("blog_title"),
            "path": normalize_path(row.get("path")),
            "reason": f"Themenüberschneidung: {', '.join(sorted((q_tokens & tokens(row.get('blog_title') or '')))[:3]) or row.get('category') or 'verwandtes Thema'}",
        }
        for _, row in scored[:5]
    ]


def classify_feedback(before, after, analytics_before, analytics_after):
    impressions_delta = int(after.get("impressions") or 0) - int(before.get("impressions") or 0)
    clicks_delta = int(after.get("clicks") or 0) - int(before.get("clicks") or 0)
    traffic_delta = int(analytics_after.get("visits") or 0) - int(analytics_before.get("visits") or 0)
    pos_before = before.get("position")
    pos_after = after.get("position")
    ranking_delta = None
    if pos_before is not None and pos_after is not None:
        ranking_delta = round(float(pos_before) - float(pos_after), 2)

    if int(after.get("impressions") or 0) == 0 and int(analytics_after.get("visits") or 0) == 0:
        return "no_data", ranking_delta, traffic_delta
    if clicks_delta > 0 or traffic_delta > 3 or (ranking_delta is not None and ranking_delta >= 2):
        return "growing", ranking_delta, traffic_delta
    if impressions_delta > 5 and clicks_delta <= 0:
        return "refresh_needed", ranking_delta, traffic_delta
    if traffic_delta < -3 or (ranking_delta is not None and ranking_delta <= -3):
        return "watch", ranking_delta, traffic_delta
    return "watch", ranking_delta, traffic_delta


def build_suggestions(status, post, top_queries, before, after, links):
    keyword = post.get("blog_primary_keyword") or post.get("blog_title") or "Thema"
    suggestions = []
    if status == "no_data":
        suggestions.extend([
            "Indexierung und Sitemap prüfen.",
            "2 bis 3 interne Links von passenden bestehenden Artikeln aufbauen.",
            "Title und Meta so schärfen, dass der Hauptnutzen sofort sichtbar ist.",
        ])
    elif status == "refresh_needed":
        suggestions.extend([
            "Title und Meta auf Suchintent der Top-Queries nachziehen.",
            "FAQ-Block aus echten Suchanfragen ergänzen.",
            "Ein CTA früher im Artikel platzieren und Rechner/Bewertung passend verlinken.",
        ])
    elif status == "growing":
        suggestions.extend([
            "Artikel nicht duplizieren, sondern mit 1 bis 2 vertiefenden Abschnitten stärken.",
            "Mehr interne Links aus thematisch nahen Artikeln setzen.",
            "Social- und GBP-Entwurf für Reichweite vorbereiten, aber nicht automatisch posten.",
        ])
    else:
        suggestions.extend([
            "Weitere 7 Tage beobachten.",
            "Snippet und interne Links prüfen, wenn Klicks trotz Impressionen ausbleiben.",
        ])

    if top_queries:
        suggestions.append(f"Top-Query als Abschnitt prüfen: {top_queries[0].get('query')}")
    if links:
        suggestions.append(f"Interne Linkchance: {links[0].get('title')}")

    social_gbp = {
        "linkedin": f"Learning-Post: Was der Artikel zu {keyword} nach Veröffentlichung zeigt und welche Frage Käufer wirklich stellen.",
        "facebook": f"Kurzpost vorbereiten: {keyword} verständlich erklärt, mit Hinweis auf den Blogartikel.",
        "instagram": f"Carousel-Idee: 3 häufige Fragen zu {keyword}.",
        "gbp": f"GBP-Entwurf vorbereiten: Neuer Ratgeber zu {keyword}, Freigabe erforderlich.",
        "autopost_allowed": False,
    }
    return suggestions[:6], social_gbp


def upsert_feedback(tenant, post, milestone, force=False):
    pub_dt = parse_pg_timestamp(post["published_at"])
    pub_date = pub_dt.date()
    age = (date.today() - pub_date).days
    if age < milestone:
        return None

    existing = ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text FROM seo_asset_feedback
          WHERE tenant_id = {sql_quote(tenant['id'])}::uuid
            AND post_id = {sql_quote(post['id'])}::uuid
            AND milestone_days = {int(milestone)}
          LIMIT 1
        ) t;
        """
    )
    if existing and not force:
        return None

    path = asset_path_for_post(tenant, post)
    before_start = pub_date - timedelta(days=milestone)
    before_end = pub_date - timedelta(days=1)
    after_start = pub_date
    after_end = pub_date + timedelta(days=milestone - 1)
    if after_end > date.today():
        after_end = date.today()

    gsc_before, _ = gsc_metrics(tenant["gsc_site"], path, before_start, before_end)
    gsc_after, top_queries = gsc_metrics(tenant["gsc_site"], path, after_start, after_end)
    analytics_before = analytics_metrics(tenant, path, before_start, before_end)
    analytics_after = analytics_metrics(tenant, path, after_start, after_end)
    status, ranking_delta, traffic_delta = classify_feedback(gsc_before, gsc_after, analytics_before, analytics_after)
    links = related_internal_links(tenant["id"], post, path, top_queries)
    refresh_suggestions, social_gbp = build_suggestions(status, post, top_queries, gsc_before, gsc_after, links)

    summary = (
        f"{milestone}-Tage-Feedback für {post.get('blog_title')}: "
        f"{int(gsc_after.get('impressions') or 0)} Impressions, "
        f"{int(gsc_after.get('clicks') or 0)} Klicks, "
        f"{int(analytics_after.get('visits') or 0)} Visits. Status: {status}."
    )
    payload = {
        "window_before": [before_start.isoformat(), before_end.isoformat()],
        "window_after": [after_start.isoformat(), after_end.isoformat()],
        "analytics_available": analytics_after.get("available", False),
        "gsc_site": tenant.get("gsc_site"),
    }
    ghostwriter_exec(
        f"""
        INSERT INTO seo_asset_feedback (
          tenant_id, post_id, asset_type, asset_path, asset_title, milestone_days, published_at,
          gsc_clicks_before, gsc_clicks_after, gsc_impressions_before, gsc_impressions_after,
          gsc_position_before, gsc_position_after,
          analytics_visits_before, analytics_visits_after,
          ranking_delta, traffic_delta, status, summary, top_queries,
          internal_link_opportunities, refresh_suggestions, social_gbp_suggestions, source_payload, evaluated_at, updated_at
        ) VALUES (
          {sql_quote(tenant['id'])}::uuid, {sql_quote(post['id'])}::uuid, 'blog_post',
          {sql_quote(path)}, {sql_quote(post.get('blog_title'))}, {int(milestone)}, {sql_quote(post.get('published_at'))}::timestamptz,
          {int(gsc_before.get('clicks') or 0)}, {int(gsc_after.get('clicks') or 0)},
          {int(gsc_before.get('impressions') or 0)}, {int(gsc_after.get('impressions') or 0)},
          {sql_quote(gsc_before.get('position'))}, {sql_quote(gsc_after.get('position'))},
          {int(analytics_before.get('visits') or 0)}, {int(analytics_after.get('visits') or 0)},
          {sql_quote(ranking_delta)}, {int(traffic_delta)}, {sql_quote(status)}, {sql_quote(summary)},
          {sql_quote(json.dumps(top_queries, ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(links, ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(refresh_suggestions, ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(social_gbp, ensure_ascii=False))}::jsonb,
          {sql_quote(json.dumps(payload, ensure_ascii=False))}::jsonb,
          now(), now()
        )
        ON CONFLICT (tenant_id, post_id, milestone_days) DO UPDATE SET
          asset_path = EXCLUDED.asset_path,
          asset_title = EXCLUDED.asset_title,
          published_at = EXCLUDED.published_at,
          gsc_clicks_before = EXCLUDED.gsc_clicks_before,
          gsc_clicks_after = EXCLUDED.gsc_clicks_after,
          gsc_impressions_before = EXCLUDED.gsc_impressions_before,
          gsc_impressions_after = EXCLUDED.gsc_impressions_after,
          gsc_position_before = EXCLUDED.gsc_position_before,
          gsc_position_after = EXCLUDED.gsc_position_after,
          analytics_visits_before = EXCLUDED.analytics_visits_before,
          analytics_visits_after = EXCLUDED.analytics_visits_after,
          ranking_delta = EXCLUDED.ranking_delta,
          traffic_delta = EXCLUDED.traffic_delta,
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          top_queries = EXCLUDED.top_queries,
          internal_link_opportunities = EXCLUDED.internal_link_opportunities,
          refresh_suggestions = EXCLUDED.refresh_suggestions,
          social_gbp_suggestions = EXCLUDED.social_gbp_suggestions,
          source_payload = EXCLUDED.source_payload,
          evaluated_at = now(),
          updated_at = now();
        """
    )
    return {"tenant": tenant, "post": post, "milestone": milestone, "status": status, "summary": summary, "path": path}


def telegram_topic(tenant):
    return tenant.get("project_key") or tenant.get("analytics_tenant_key") or tenant.get("slug") or "oc"


def send_telegram_summaries(dry_run=False):
    rows = ghostwriter_json(
        """
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT f.id::text, f.tenant_id::text, t.name AS tenant_name, t.slug AS tenant_slug,
                 ts.project_key, ts.analytics_tenant_key,
                 f.asset_title, f.asset_path, f.milestone_days, f.status,
                 f.gsc_impressions_after, f.gsc_clicks_after, f.analytics_visits_after,
                 f.ranking_delta, f.traffic_delta, f.refresh_suggestions
          FROM seo_asset_feedback f
          JOIN tenants t ON t.id = f.tenant_id
          LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
          WHERE f.telegram_sent_at IS NULL
          ORDER BY t.name, f.evaluated_at DESC
          LIMIT 20
        ) t;
        """
    )
    if not rows:
        return 0
    by_tenant = {}
    for row in rows:
        by_tenant.setdefault(row["tenant_id"], []).append(row)
    sent = 0
    for tenant_id, items in by_tenant.items():
        first = items[0]
        topic = first.get("project_key") or first.get("analytics_tenant_key") or first.get("tenant_slug") or "oc"
        lines = [
            "<b>SEO Feedback Loop</b>",
            f"{first.get('tenant_name')}: {len(items)} neue Asset-Auswertung(en)",
            "",
        ]
        for item in items[:5]:
            suggestion = ""
            if item.get("refresh_suggestions"):
                suggestion = item["refresh_suggestions"][0] if isinstance(item["refresh_suggestions"], list) else ""
            lines.append(
                f"• {item['milestone_days']} Tage: {item['asset_title'][:80]}\n"
                f"  Status: {item['status']}, GSC {item['gsc_impressions_after']} Impr. / {item['gsc_clicks_after']} Klicks, Visits {item['analytics_visits_after']}\n"
                f"  Vorschlag: {suggestion or 'weiter beobachten'}"
            )
        lines.append("")
        lines.append("Social/GBP sind nur vorbereitet, nicht gepostet. Freigabe bleibt nötig.")
        message = "\n".join(lines)
        if not dry_run:
            run([TG_SEND, topic, message, "html"], timeout=20, check=False)
            ids = ",".join(sql_quote(item["id"]) for item in items)
            ghostwriter_exec(f"UPDATE seo_asset_feedback SET telegram_sent_at = now(), updated_at = now() WHERE id IN ({ids});")
        sent += 1
    return sent


def record_run(status, tenants_checked, assets_checked, upserted, telegram_messages, message=None):
    ghostwriter_exec(
        f"""
        INSERT INTO seo_feedback_runs (
          finished_at, status, tenants_checked, assets_checked, feedback_upserted, telegram_messages, message
        ) VALUES (
          now(), {sql_quote(status)}, {int(tenants_checked)}, {int(assets_checked)}, {int(upserted)}, {int(telegram_messages)}, {sql_quote((message or '')[:900])}
        );
        """
    )


def main():
    parser = argparse.ArgumentParser(description="Evaluate post-publish SEO feedback for Ghostwriter assets.")
    parser.add_argument("--tenant", help="analytics_tenant_key or tenant slug")
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--send-telegram", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ensure_schema()
    tenants = get_tenants()
    if args.tenant:
        tenants = [t for t in tenants if t.get("analytics_tenant_key") == args.tenant or t.get("slug") == args.tenant]
    tenants_checked = 0
    assets_checked = 0
    upserted = 0
    try:
        for tenant in tenants:
            tenants_checked += 1
            posts = filter_public_posts(tenant, get_published_posts(tenant["id"], args.limit))
            if args.force:
                prune_stale_feedback(tenant, posts)
            for post in posts:
                for milestone in MILESTONES:
                    assets_checked += 1
                    result = upsert_feedback(tenant, post, milestone, force=args.force)
                    if result:
                        upserted += 1
                        if args.dry_run:
                            print(json.dumps(result, ensure_ascii=False, default=str))
        telegram_messages = send_telegram_summaries(dry_run=args.dry_run) if args.send_telegram else 0
        record_run("success", tenants_checked, assets_checked, upserted, telegram_messages)
        print(json.dumps({
            "status": "success",
            "tenants_checked": tenants_checked,
            "assets_checked": assets_checked,
            "feedback_upserted": upserted,
            "telegram_messages": telegram_messages,
        }, ensure_ascii=False))
    except Exception as exc:
        record_run("failed", tenants_checked, assets_checked, upserted, 0, str(exc))
        raise


if __name__ == "__main__":
    main()
