import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";

  let days;
  switch (range) {
    case "7d": days = 7; break;
    case "1y": days = 365; break;
    default: days = 30; break;
  }

  const periodStart = new Date(Date.now() - days * 86400000).toISOString();
  const prevStart = new Date(Date.now() - days * 2 * 86400000).toISOString();
  const truncFn = range === "1y" ? "date_trunc('month', created_at)" : "created_at::date";

  const [
    { rows: [currentStats] },
    { rows: [prevStats] },
    { rows: timeSeries },
    { rows: prevTimeSeries },
    { rows: [tenantStats] },
    { rows: recentPosts },
    { rows: tenants },
  ] = await Promise.all([
    query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status='published')::int as published,
              COUNT(*) FILTER (WHERE status='failed')::int as failed
       FROM ghostwriter_posts WHERE created_at >= $1`, [periodStart]
    ),
    query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status='published')::int as published,
              COUNT(*) FILTER (WHERE status='failed')::int as failed
       FROM ghostwriter_posts WHERE created_at >= $1 AND created_at < $2`, [prevStart, periodStart]
    ),
    query(
      `SELECT ${truncFn} as date,
              COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status='published')::int as published,
              COUNT(*) FILTER (WHERE status='failed')::int as failed
       FROM ghostwriter_posts WHERE created_at >= $1
       GROUP BY 1 ORDER BY 1`, [periodStart]
    ),
    query(
      `SELECT ${truncFn} as date,
              COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status='published')::int as published,
              COUNT(*) FILTER (WHERE status='failed')::int as failed
       FROM ghostwriter_posts WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY 1`, [prevStart, periodStart]
    ),
    query(`SELECT COUNT(*)::int as total FROM tenants WHERE status = 'active'`),
    query(
      `SELECT gp.id, gp.blog_title, gp.language, gp.category, gp.status, gp.created_at,
              t.name as tenant_name
       FROM ghostwriter_posts gp JOIN tenants t ON t.id = gp.tenant_id
       ORDER BY gp.created_at DESC LIMIT 10`
    ),
    query(
      `SELECT t.id, t.name, t.slug, ts.is_active as autopilot_active, ts.next_run_at,
              (SELECT COUNT(*)::int FROM ghostwriter_posts WHERE tenant_id = t.id AND status = 'published') as post_count
       FROM tenants t LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
       WHERE t.status = 'active'
       ORDER BY ts.next_run_at ASC NULLS LAST`
    ),
  ]);

  return NextResponse.json({
    range,
    stats: { current: currentStats, previous: prevStats, tenants: tenantStats.total },
    timeSeries,
    prevTimeSeries,
    recentPosts,
    tenants,
  });
}
