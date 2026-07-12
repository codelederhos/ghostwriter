export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows: tenants } = await query(
    "SELECT id, name, slug FROM tenants WHERE status = 'active' ORDER BY name"
  );

  const result = [];
  for (const t of tenants) {
    const { rows: [stats] } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'published') AS published,
         COUNT(*) FILTER (WHERE status = 'draft')     AS draft,
         COUNT(*) FILTER (WHERE status = 'review')    AS review
       FROM seo_pages WHERE tenant_id = $1`,
      [t.id]
    );
    const { rows: [diag] } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE d.severity = 'critical') AS critical,
         COUNT(*) FILTER (WHERE d.severity = 'warn')     AS warn,
         COUNT(*) FILTER (WHERE d.flag_not_indexed)      AS not_indexed,
         COUNT(*) FILTER (WHERE d.flag_near_page1)       AS near_page1
       FROM seo_page_diagnostics d
       JOIN seo_pages p ON p.id = d.page_id
       WHERE p.tenant_id = $1`,
      [t.id]
    );
    const { rows: [metrics] } = await query(
      `SELECT
         SUM(m.gsc_clicks) AS clicks_7d,
         AVG(m.gsc_position) FILTER (WHERE m.gsc_position > 0) AS avg_pos
       FROM seo_page_metrics m
       JOIN seo_pages p ON p.id = m.page_id
       WHERE p.tenant_id = $1 AND m.date >= CURRENT_DATE - INTERVAL '7 days'`,
      [t.id]
    );
    result.push({
      slug: t.slug, name: t.name,
      published: parseInt(stats?.published || 0),
      draft: parseInt(stats?.draft || 0),
      review: parseInt(stats?.review || 0),
      critical: parseInt(diag?.critical || 0),
      warn: parseInt(diag?.warn || 0),
      not_indexed: parseInt(diag?.not_indexed || 0),
      near_page1: parseInt(diag?.near_page1 || 0),
      clicks_7d: parseInt(metrics?.clicks_7d || 0),
      avg_pos: metrics?.avg_pos ? parseFloat(metrics.avg_pos).toFixed(1) : null,
    });
  }
  return NextResponse.json({ tenants: result });
}
