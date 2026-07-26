export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenant } = params;
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "all"; // all|critical|warn|ok|not_indexed|near_page1
  const lang   = url.searchParams.get("lang") || "";
  const limit  = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const { rows: [t] } = await query("SELECT id FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bindParams = [t.id];
  let whereExtra = "";
  if (filter === "critical")    whereExtra = "AND d.severity = 'critical'";
  if (filter === "warn")        whereExtra = "AND d.severity = 'warn'";
  if (filter === "ok")          whereExtra = "AND (d.severity = 'ok' OR d.page_id IS NULL)";
  if (filter === "not_indexed") whereExtra = "AND d.flag_not_indexed = TRUE";
  if (filter === "near_page1")  whereExtra = "AND d.flag_near_page1 = TRUE";
  if (lang) { bindParams.push(lang); whereExtra += ` AND p.lang = $${bindParams.length}`; }

  const { rows: pages } = await query(
    `SELECT
       p.id, p.slug, p.lang, p.title, p.h1, p.status,
       p.published_at, p.ki_generated_at,
       l.name->>'de' AS location_name,
       pt.slug_template,
       d.severity,
       d.flag_not_indexed, d.flag_ctr_low, d.flag_bounce_high,
       d.flag_no_cta, d.flag_position_drop, d.flag_near_page1, d.flag_keyword_gap,
       m7.gsc_impressions AS imp_7d, m7.gsc_clicks AS clicks_7d,
       m7.gsc_position AS pos_7d, m7.ana_sessions AS sessions_7d,
       m7.ana_cta_clicks AS cta_7d
     FROM seo_pages p
     JOIN seo_locations l ON l.id = p.location_id
     JOIN seo_page_types pt ON pt.id = p.page_type_id
     LEFT JOIN seo_page_diagnostics d ON d.page_id = p.id
     LEFT JOIN LATERAL (
       SELECT SUM(gsc_impressions) AS gsc_impressions,
              SUM(gsc_clicks) AS gsc_clicks,
              AVG(NULLIF(gsc_position,0)) AS gsc_position,
              SUM(ana_sessions) AS ana_sessions,
              SUM(ana_cta_clicks) AS ana_cta_clicks
       FROM seo_page_metrics
       WHERE page_id = p.id AND date >= CURRENT_DATE - 7
     ) m7 ON TRUE
     WHERE p.tenant_id = $1 ${whereExtra}
     ORDER BY
       CASE d.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
       m7.gsc_impressions DESC NULLS LAST
     LIMIT $${bindParams.length + 1} OFFSET $${bindParams.length + 2}`,
    [...bindParams, limit, offset]
  );

  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*) AS total FROM seo_pages p
     LEFT JOIN seo_page_diagnostics d ON d.page_id = p.id
     WHERE p.tenant_id = $1`,
    [t.id]
  );

  return NextResponse.json({ pages, total: parseInt(total), limit, offset });
}
