import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function ensureSchema() {
  await query(`
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
  `);
}

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId") || "";
  const recommendation = searchParams.get("recommendation") || "";
  const status = searchParams.get("status") || "open";
  const limit = Math.min(parseInt(searchParams.get("limit") || "120", 10), 300);

  const params = [];
  const where = [];
  if (tenantId) {
    params.push(tenantId);
    where.push(`o.tenant_id = $${params.length}`);
  }
  if (recommendation) {
    params.push(recommendation);
    where.push(`o.recommendation = $${params.length}`);
  }
  if (status && status !== "all") {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [
    { rows: tenants },
    { rows: opportunities },
    { rows: stats },
    { rows: runs },
  ] = await Promise.all([
    query("SELECT id, name, slug FROM tenants WHERE status = 'active' ORDER BY name"),
    query(
      `SELECT o.id, o.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
              o.query, o.page, o.topic, o.opportunity_type, o.recommendation, o.reason,
              o.impressions, o.clicks, o.ctr, o.position,
              o.analytics_visits, o.analytics_unique_visitors, o.analytics_conversions,
              o.priority_score, o.matched_asset_type, o.matched_asset_id, o.matched_asset_title,
              o.status, o.signal_payload, o.last_seen, o.updated_at
       FROM seo_signal_opportunities o
       JOIN tenants t ON t.id = o.tenant_id
       ${whereSql}
       ORDER BY o.priority_score DESC, o.impressions DESC, o.updated_at DESC
       LIMIT ${limit}`,
      params
    ),
    query(
      `SELECT recommendation,
              COUNT(*)::int AS count,
              MAX(priority_score)::int AS max_score,
              SUM(impressions)::int AS impressions,
              SUM(clicks)::int AS clicks,
              SUM(analytics_visits)::int AS analytics_visits
       FROM seo_signal_opportunities
       WHERE status = 'open'
       GROUP BY recommendation
       ORDER BY max_score DESC, count DESC`
    ),
    query(
      `SELECT r.id, r.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
              r.finished_at, r.status, r.days, r.gsc_rows, r.analytics_pages,
              r.opportunities_upserted, r.message
       FROM seo_signal_sync_runs r
       LEFT JOIN tenants t ON t.id = r.tenant_id
       ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
       LIMIT 12`
    ),
  ]);

  return NextResponse.json({ tenants, opportunities, stats, runs });
}

export async function PATCH(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status } = await req.json();
  if (!id || !["open", "in_progress", "resolved", "ignored"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  await query("UPDATE seo_signal_opportunities SET status = $1, updated_at = now() WHERE id = $2", [status, id]);
  return NextResponse.json({ ok: true });
}
