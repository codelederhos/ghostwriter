import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function ensureSchema() {
  await query(`
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
  `);
}

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId") || "";
  const status = searchParams.get("status") || "";
  const milestone = searchParams.get("milestone") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "120", 10), 300);

  const params = [];
  const where = [];
  if (tenantId) {
    params.push(tenantId);
    where.push(`f.tenant_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`f.status = $${params.length}`);
  }
  if (milestone) {
    params.push(Number(milestone));
    where.push(`f.milestone_days = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [
    { rows: tenants },
    { rows: feedback },
    { rows: stats },
    { rows: runs },
  ] = await Promise.all([
    query("SELECT id, name, slug FROM tenants WHERE status = 'active' ORDER BY name"),
    query(
      `SELECT f.*, t.name AS tenant_name, t.slug AS tenant_slug
       FROM seo_asset_feedback f
       JOIN tenants t ON t.id = f.tenant_id
       ${whereSql}
       ORDER BY f.evaluated_at DESC, f.milestone_days DESC
       LIMIT ${limit}`,
      params
    ),
    query(
      `SELECT status,
              COUNT(*)::int AS count,
              SUM(gsc_impressions_after)::int AS impressions,
              SUM(gsc_clicks_after)::int AS clicks,
              SUM(analytics_visits_after)::int AS visits
       FROM seo_asset_feedback
       GROUP BY status
       ORDER BY count DESC`
    ),
    query(
      `SELECT *
       FROM seo_feedback_runs
       ORDER BY finished_at DESC NULLS LAST, started_at DESC
       LIMIT 10`
    ),
  ]);

  return NextResponse.json({ tenants, feedback, stats, runs });
}
