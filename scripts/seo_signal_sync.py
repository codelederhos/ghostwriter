#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import re
import sqlite3
import subprocess
from datetime import date, timedelta
from urllib.parse import urlparse

GHOSTWRITER_DB_CONTAINER = "ghostwriter-db-1"
BAURIMMO_DB_CONTAINER = "baurimmo-next-db"
ANALYTICS_CONFIG = "/opt/analytics-reports/config.json"
GSC_DB = "/opt/analytics-reports/gsc_history.db"

TOOL_PATH_HINTS = (
    "rechner", "kaufnebenkosten", "notarkosten", "rendite", "mietspiegel",
    "immobilienmarkt", "suchprofil", "sofort-ankauf", "offmarket", "bewerben",
)
BRAND_HINTS = {
    "baur-immobilien": ("baur", "baur immobilien", "immobilien baur", "eduard rups"),
    "code-lederhos": ("code lederhos", "lederhos", "stani", "stanislaw lederhos"),
    "gabriela": ("gabriela lederhos", "gaby lederhos", "gabriela fotografie"),
    "staned": ("staned", "staned gmbh"),
}
CITY_HINTS = (
    "regensburg", "stuttgart", "nuernberg", "nürnberg", "muenchen", "münchen",
    "erlangen", "tegernheim", "bayern", "deutschland", "germany",
)


def run(args, input_text=None, timeout=30, check=True):
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
    out = run(["docker", "exec", "-i", container, "psql", "-U", user, "-d", database, "-At", "-c", sql], timeout=45)
    return json.loads(out or "[]")


def psql_exec(container, user, database, sql):
    return run(["docker", "exec", "-i", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=60)


def ghostwriter_json(sql):
    return psql_json(GHOSTWRITER_DB_CONTAINER, "ghostwriter", "ghostwriter", sql)


def ghostwriter_exec(sql):
    return psql_exec(GHOSTWRITER_DB_CONTAINER, "ghostwriter", "ghostwriter", sql)


def baurimmo_json(sql):
    return psql_json(BAURIMMO_DB_CONTAINER, "baurimmo", "baurimmo", sql)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_path(value):
    if not value:
        return "/"
    value = str(value).strip()
    if value.startswith("http"):
        try:
            value = urlparse(value).path or "/"
        except Exception:
            pass
    value = re.sub(r"[?#].*$", "", value)
    if not value.startswith("/"):
        value = "/" + value
    if value != "/" and not value.endswith("/"):
        value += "/"
    return value


def slug_from_path(path):
    path = normalize_path(path).strip("/")
    if not path:
        return ""
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("blog", "de", "en"):
        return parts[-1]
    return parts[-1]


def topic_from_query(query, path):
    text = (query or slug_from_path(path) or "").lower()
    text = re.sub(r"[^a-z0-9äöüß\\s-]+", " ", text)
    text = re.sub(r"\\s+", " ", text).strip()
    return text[:180]


def looks_like_brand(tenant_slug, query):
    q = (query or "").lower()
    return any(hint in q for hint in BRAND_HINTS.get(tenant_slug, ()))


def is_tool_page(path):
    p = normalize_path(path).lower()
    return any(hint in p for hint in TOOL_PATH_HINTS)


def has_city_intent(query, path):
    text = f"{query or ''} {path or ''}".lower()
    return any(hint in text for hint in CITY_HINTS)


def score_opportunity(impressions, clicks, position, analytics_visits, matched_type):
    score = min(45, int(impressions or 0))
    score += min(20, int(analytics_visits or 0) // 3)
    if position:
      if 4 <= float(position) <= 20:
          score += 25
      elif float(position) <= 3:
          score += 10
      elif float(position) <= 50:
          score += 12
    if clicks:
        score += min(10, int(clicks) * 2)
    if matched_type in ("tool", "landing_page", "blog"):
        score += 8
    return max(0, min(score, 100))


def classify(tenant_slug, query, page, matched_asset, impressions, clicks, position):
    page = normalize_path(page)
    if looks_like_brand(tenant_slug, query):
        return "refresh_existing_page", "Brand/Local-Seite stärken, kein Blogartikel nötig", "brand_authority"
    if is_tool_page(page):
        return "support_article", "Tool-Seite schützen und mit ergänzendem Support-Content stärken", "tool_support"
    if matched_asset:
        if position and 4 <= float(position) <= 20:
            return "refresh_existing_page", "Bestehendes Asset nahe Seite 1 verbessern", "refresh_quickwin"
        return "title_optimization", "Bestehendes Asset hat Signal, Titel/Meta/Interne Links prüfen", "existing_asset"
    if has_city_intent(query, page):
        return "new_landing_page", "Regionaler Intent ohne klares Asset", "regional_gap"
    if impressions and int(impressions) <= 2 and not clicks:
        return "social_only", "Schwaches Suchsignal, eher für Social-Idee merken", "weak_signal"
    return "new_blog_article", "Themenlücke aus GSC-Signal ohne vorhandenes Asset", "content_gap"


def ensure_schema():
    ghostwriter_exec(
        """
        CREATE TABLE IF NOT EXISTS seo_signal_opportunities (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          source_key text NOT NULL,
          source text NOT NULL DEFAULT 'gsc_analytics',
          query text,
          page text,
          topic text,
          opportunity_type text NOT NULL,
          recommendation text NOT NULL,
          reason text,
          impressions integer NOT NULL DEFAULT 0,
          clicks integer NOT NULL DEFAULT 0,
          ctr numeric(8,4),
          position numeric(8,2),
          analytics_visits integer NOT NULL DEFAULT 0,
          analytics_unique_visitors integer NOT NULL DEFAULT 0,
          analytics_conversions integer NOT NULL DEFAULT 0,
          priority_score integer NOT NULL DEFAULT 0,
          matched_asset_type text,
          matched_asset_id text,
          matched_asset_title text,
          status text NOT NULL DEFAULT 'open',
          signal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          first_seen timestamptz NOT NULL DEFAULT now(),
          last_seen timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tenant_id, source_key)
        );
        CREATE INDEX IF NOT EXISTS seo_signal_opportunities_tenant_status_idx
          ON seo_signal_opportunities (tenant_id, status, priority_score DESC);
        CREATE INDEX IF NOT EXISTS seo_signal_opportunities_type_idx
          ON seo_signal_opportunities (opportunity_type, priority_score DESC);

        CREATE TABLE IF NOT EXISTS seo_signal_sync_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          status text NOT NULL DEFAULT 'running',
          days integer NOT NULL DEFAULT 28,
          gsc_rows integer NOT NULL DEFAULT 0,
          analytics_pages integer NOT NULL DEFAULT 0,
          opportunities_upserted integer NOT NULL DEFAULT 0,
          message text
        );
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
                 tenant_settings.client_api_url,
                 tenant_settings.client_push_enabled
          FROM tenants
          JOIN tenant_settings ON tenant_settings.tenant_id = tenants.id
          WHERE tenants.status = 'active'
            AND tenant_settings.analytics_tenant_key IS NOT NULL
            AND tenant_settings.gsc_site IS NOT NULL
          ORDER BY tenants.name
        ) t;
        """
    )


def load_assets(tenant):
    assets = []
    rows = ghostwriter_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT id::text, 'ghostwriter_post' AS source, 'blog' AS asset_type,
                 blog_title AS title, blog_slug AS slug,
                 COALESCE(blog_url, '/blog/' || blog_slug || '/') AS path
          FROM ghostwriter_posts
          WHERE tenant_id = {sql_quote(tenant['id'])}::uuid
            AND blog_slug IS NOT NULL
          UNION ALL
          SELECT id::text, 'seo_hub' AS source, 'landing_page' AS asset_type,
                 title, slug, '/' || slug || '/' AS path
          FROM seo_pages
          WHERE tenant_id = {sql_quote(tenant['id'])}::uuid
            AND slug IS NOT NULL
        ) t;
        """
    )
    assets.extend(rows)

    if tenant.get("analytics_tenant_key") == "baurimmo":
        try:
            client_rows = baurimmo_json(
                """
                SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
                FROM (
                  SELECT id::text, 'baurimmo_blog' AS source, 'blog' AS asset_type,
                         title, slug, '/blog/' || slug || '/' AS path
                  FROM blog_posts
                  WHERE is_published = true
                ) t;
                """
            )
            assets.extend(client_rows)
        except Exception:
            pass

    for asset in assets:
        asset["path_norm"] = normalize_path(asset.get("path"))
        asset["slug_norm"] = (asset.get("slug") or slug_from_path(asset.get("path"))).strip("/").lower()
    return assets


def match_asset(path, query, assets):
    norm = normalize_path(path)
    slug = slug_from_path(norm).lower()
    for asset in assets:
        if asset["path_norm"] == norm:
            return asset
    if slug:
        for asset in assets:
            if asset["slug_norm"] == slug:
                return asset
    q = (query or "").lower()
    if q:
        for asset in assets:
            title = (asset.get("title") or "").lower()
            if title and (q in title or title in q):
                return asset
    if is_tool_page(norm):
        return {"id": None, "asset_type": "tool", "title": slug or norm, "source": "reserved_tool", "path": norm}
    return None


def gsc_rows(site, days, limit):
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    con = sqlite3.connect(GSC_DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT query, page,
               SUM(clicks) AS clicks,
               SUM(impressions) AS impressions,
               AVG(position) AS position,
               AVG(ctr) AS ctr,
               MAX(date) AS last_date,
               COUNT(DISTINCT date) AS days_seen
        FROM gsc_keyword_history
        WHERE site = ? AND date >= ?
        GROUP BY query, page
        HAVING SUM(impressions) > 0
        ORDER BY SUM(impressions) DESC, AVG(position) ASC
        LIMIT ?
        """,
        (site, cutoff, limit),
    ).fetchall()
    con.close()
    return [dict(row) for row in rows]


def baurimmo_analytics(days):
    return baurimmo_json(
        f"""
        SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
        FROM (
          SELECT COALESCE(path, '/') AS path,
                 COUNT(*)::int AS visits,
                 COUNT(DISTINCT COALESCE(visitor_id, session_id, ip_hash))::int AS unique_visitors,
                 0::int AS conversions
          FROM analytics_events
          WHERE event_type = 'pageview'
            AND is_bot = false
            AND is_test = false
            AND created_at >= now() - interval '{int(days)} days'
            AND (path IS NULL OR path NOT LIKE '/admin%')
          GROUP BY COALESCE(path, '/')
          ORDER BY visits DESC
          LIMIT 500
        ) t;
        """
    )


def sqlite_analytics(tenant_cfg, days):
    db = tenant_cfg.get("db") or {}
    if not db.get("ssh_host") or not db.get("db_path"):
        return []
    sql = f"""
      SELECT path,
             COUNT(*) AS visits,
             COUNT(DISTINCT session_token) AS unique_visitors,
             0 AS conversions
      FROM visits
      WHERE is_bot=0
        AND DATE(created_at) >= DATE('now','-{int(days)} day')
      GROUP BY path
      ORDER BY visits DESC
      LIMIT 500;
    """
    b64 = base64.b64encode(sql.encode()).decode()
    out = run(
        ["ssh", db["ssh_host"], f"echo {b64} | base64 -d | sqlite3 -json {db['db_path']}"],
        check=False,
        timeout=25,
    )
    try:
        return json.loads(out or "[]")
    except Exception:
        return []


def mysql_helper_analytics(tenant_cfg, days):
    db = tenant_cfg.get("db") or {}
    if not db.get("ssh_host") or not db.get("helper_path"):
        return []
    out = run(
        ["ssh", db["ssh_host"], f"php {db['helper_path']} top_pages {int(days)}"],
        check=False,
        timeout=25,
    )
    try:
        payload = json.loads(out or "{}")
        data = payload.get("data") if payload.get("ok") else []
        return [
            {"path": row.get("path") or "/", "visits": row.get("views") or row.get("visits") or 0, "unique_visitors": row.get("visitors") or 0, "conversions": 0}
            for row in (data or [])
        ]
    except Exception:
        return []


def analytics_rows(tenant_key, tenant_cfg, days):
    db_type = (tenant_cfg.get("db") or {}).get("type")
    if tenant_key == "baurimmo":
        return baurimmo_analytics(days)
    if db_type == "sqlite":
        return sqlite_analytics(tenant_cfg, days)
    if db_type == "mysql-helper":
        return mysql_helper_analytics(tenant_cfg, days)
    return []


def upsert_opportunity(tenant, row, analytics_map, assets):
    page = normalize_path(row.get("page"))
    query = row.get("query") or ""
    matched = match_asset(page, query, assets)
    analytics = analytics_map.get(page, {})
    recommendation, reason, opp_type = classify(
        tenant["slug"], query, page, matched, row.get("impressions") or 0, row.get("clicks") or 0, row.get("position")
    )
    matched_type = matched.get("asset_type") if matched else None
    score = score_opportunity(row.get("impressions") or 0, row.get("clicks") or 0, row.get("position"), analytics.get("visits") or 0, matched_type)
    source_key = hashlib.sha1(f"{tenant['id']}|{query.lower()}|{page}".encode()).hexdigest()
    payload = {
        "last_gsc_date": row.get("last_date"),
        "days_seen": row.get("days_seen"),
        "matched_source": matched.get("source") if matched else None,
        "analytics_tenant_key": tenant.get("analytics_tenant_key"),
        "gsc_site": tenant.get("gsc_site"),
    }
    ghostwriter_exec(
        f"""
        INSERT INTO seo_signal_opportunities (
          tenant_id, source_key, source, query, page, topic, opportunity_type, recommendation, reason,
          impressions, clicks, ctr, position, analytics_visits, analytics_unique_visitors, analytics_conversions,
          priority_score, matched_asset_type, matched_asset_id, matched_asset_title, signal_payload, first_seen, last_seen, updated_at
        ) VALUES (
          {sql_quote(tenant['id'])}::uuid,
          {sql_quote(source_key)},
          'gsc_analytics',
          {sql_quote(query)},
          {sql_quote(page)},
          {sql_quote(topic_from_query(query, page))},
          {sql_quote(opp_type)},
          {sql_quote(recommendation)},
          {sql_quote(reason)},
          {int(row.get('impressions') or 0)},
          {int(row.get('clicks') or 0)},
          {sql_quote(row.get('ctr'))},
          {sql_quote(row.get('position'))},
          {int(analytics.get('visits') or 0)},
          {int(analytics.get('unique_visitors') or 0)},
          {int(analytics.get('conversions') or 0)},
          {int(score)},
          {sql_quote(matched_type)},
          {sql_quote(matched.get('id') if matched else None)},
          {sql_quote(matched.get('title') if matched else None)},
          {sql_quote(json.dumps(payload, ensure_ascii=False))}::jsonb,
          now(), now(), now()
        )
        ON CONFLICT (tenant_id, source_key) DO UPDATE SET
          query = EXCLUDED.query,
          page = EXCLUDED.page,
          topic = EXCLUDED.topic,
          opportunity_type = EXCLUDED.opportunity_type,
          recommendation = EXCLUDED.recommendation,
          reason = EXCLUDED.reason,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          ctr = EXCLUDED.ctr,
          position = EXCLUDED.position,
          analytics_visits = EXCLUDED.analytics_visits,
          analytics_unique_visitors = EXCLUDED.analytics_unique_visitors,
          analytics_conversions = EXCLUDED.analytics_conversions,
          priority_score = EXCLUDED.priority_score,
          matched_asset_type = EXCLUDED.matched_asset_type,
          matched_asset_id = EXCLUDED.matched_asset_id,
          matched_asset_title = EXCLUDED.matched_asset_title,
          signal_payload = EXCLUDED.signal_payload,
          last_seen = now(),
          updated_at = now();
        """
    )
    return {
        "query": query,
        "page": page,
        "type": opp_type,
        "score": score,
        "asset": matched.get("title") if matched else None,
    }


def mark_run(tenant_id, status, days, gsc_count=0, analytics_count=0, upserted=0, message=""):
    ghostwriter_exec(
        f"""
        INSERT INTO seo_signal_sync_runs (tenant_id, status, days, gsc_rows, analytics_pages, opportunities_upserted, message, finished_at)
        VALUES ({sql_quote(tenant_id)}::uuid, {sql_quote(status)}, {int(days)}, {int(gsc_count)}, {int(analytics_count)}, {int(upserted)}, {sql_quote(message[:900])}, now());
        """
    )


def main():
    parser = argparse.ArgumentParser(description="Sync GSC and Analytics signals into Ghostwriter SEO opportunities.")
    parser.add_argument("--tenant", help="analytics_tenant_key filter")
    parser.add_argument("--days", type=int, default=28)
    parser.add_argument("--limit", type=int, default=250)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ensure_schema()
    config = read_json(ANALYTICS_CONFIG)
    analytics_cfg = config.get("tenants") or {}
    tenants = get_tenants()
    if args.tenant:
        tenants = [t for t in tenants if t.get("analytics_tenant_key") == args.tenant]

    total = 0
    for tenant in tenants:
        key = tenant.get("analytics_tenant_key")
        cfg = analytics_cfg.get(key) or {}
        try:
            assets = load_assets(tenant)
            gsc = gsc_rows(tenant.get("gsc_site"), args.days, args.limit)
            analytics = analytics_rows(key, cfg, args.days)
            analytics_map = {normalize_path(r.get("path")): r for r in analytics}
            top = []
            if not args.dry_run:
                for row in gsc:
                    top.append(upsert_opportunity(tenant, row, analytics_map, assets))
                mark_run(tenant["id"], "success", args.days, len(gsc), len(analytics), len(gsc), "sync ok")
            else:
                top = [{"query": r.get("query"), "page": normalize_path(r.get("page")), "impressions": r.get("impressions")} for r in gsc[:10]]
            total += len(gsc)
            print(json.dumps({
                "tenant": key,
                "gsc_rows": len(gsc),
                "analytics_pages": len(analytics),
                "assets": len(assets),
                "upserted": 0 if args.dry_run else len(gsc),
                "top": top[:5],
            }, ensure_ascii=False))
        except Exception as exc:
            if not args.dry_run:
                mark_run(tenant["id"], "error", args.days, 0, 0, 0, str(exc))
            print(json.dumps({"tenant": key, "error": str(exc)}, ensure_ascii=False))
    print(json.dumps({"total_gsc_rows": total, "tenants": len(tenants), "dry_run": args.dry_run}, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
