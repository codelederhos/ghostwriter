import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function ensureSchema() {
  await query(`
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
  `);
}

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId") || "";
  const weekStart = searchParams.get("weekStart") || "";
  const status = searchParams.get("status") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "120", 10), 300);

  const params = [];
  const where = [];
  if (tenantId) {
    params.push(tenantId);
    where.push(`c.tenant_id = $${params.length}`);
  }
  if (weekStart) {
    params.push(weekStart);
    where.push(`c.week_start = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [
    { rows: tenants },
    { rows: candidates },
    { rows: weeks },
    { rows: stats },
    { rows: runs },
  ] = await Promise.all([
    query("SELECT id, name, slug FROM tenants WHERE status = 'active' ORDER BY name"),
    query(
      `SELECT c.*, t.name AS tenant_name, t.slug AS tenant_slug
       FROM seo_weekly_content_candidates c
       JOIN tenants t ON t.id = c.tenant_id
       ${whereSql}
       ORDER BY c.week_start DESC, t.name, c.slot
       LIMIT ${limit}`,
      params
    ),
    query(
      `SELECT week_start,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE telegram_sent_at IS NOT NULL)::int AS sent,
              MAX(created_at) AS last_created_at
       FROM seo_weekly_content_candidates
       GROUP BY week_start
       ORDER BY week_start DESC
       LIMIT 12`
    ),
    query(
      `SELECT status,
              COUNT(*)::int AS count,
              ROUND(AVG(score))::int AS avg_score,
              COUNT(*) FILTER (WHERE telegram_sent_at IS NOT NULL)::int AS sent
       FROM seo_weekly_content_candidates
       GROUP BY status
       ORDER BY count DESC`
    ),
    query(
      `SELECT *
       FROM seo_weekly_content_scout_runs
       ORDER BY finished_at DESC NULLS LAST, started_at DESC
       LIMIT 12`
    ),
  ]);

  return NextResponse.json({ tenants, candidates, weeks, stats, runs });
}

export async function PATCH(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status } = await req.json();
  if (!id || !["brief_ready", "in_review", "draft_requested", "done", "ignored"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  await query("UPDATE seo_weekly_content_candidates SET status = $1, updated_at = now() WHERE id = $2", [status, id]);
  return NextResponse.json({ ok: true });
}
