import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCustomer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireCustomer();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = session.tenant_id;

  const { rows: [tenant] } = await query("SELECT name, slug, domain FROM tenants WHERE id = $1", [tenantId]);
  const { rows: [profile] } = await query("SELECT company_name, industry, region FROM tenant_profiles WHERE tenant_id = $1", [tenantId]);
  const { rows: [settings] } = await query("SELECT is_active, frequency_hours, next_run_at FROM tenant_settings WHERE tenant_id = $1", [tenantId]);

  const { rows: [stats] } = await query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'published')::int as published,
      COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int as month
    FROM ghostwriter_posts WHERE tenant_id = $1
  `, [tenantId]);

  const { rows: posts } = await query(`
    SELECT id, blog_title, blog_slug, language, category, status, image_url, published_at, created_at
    FROM ghostwriter_posts
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [tenantId]);

  return NextResponse.json({
    tenant,
    profile,
    settings: {
      autopilot_active: settings?.is_active,
      frequency_hours: settings?.frequency_hours,
      next_run_at: settings?.next_run_at,
    },
    stats,
    posts,
  });
}
