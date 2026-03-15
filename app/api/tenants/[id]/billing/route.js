import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;

  // Pricing config
  const { rows: configRows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
  const pricing = configRows[0]?.value || { post_price_cents: 300, backlink_price_cents: 100, membership_monthly_cents: 0 };

  // Billing periods
  const { rows: periods } = await query(
    "SELECT * FROM billing_periods WHERE tenant_id = $1 ORDER BY period_start DESC",
    [id]
  );

  // Open posts (not yet in any billing period)
  const lastInvoiced = periods.find(p => p.status !== "open");
  const sinceDate = lastInvoiced ? lastInvoiced.period_end : "2020-01-01";

  const { rows: openPosts } = await query(
    `SELECT id, blog_title, category, angle, billing_mode, cost_cents, created_at
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND is_test = false AND status != 'failed'
       AND billing_mode = 'platform' AND created_at > $2
     ORDER BY created_at DESC`,
    [id, sinceDate]
  );

  // Summary
  const openTotal = openPosts.length * pricing.post_price_cents;

  return NextResponse.json({ pricing, periods, openPosts, openTotal });
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "create_invoice": {
      const { period_start, period_end } = body;
      if (!period_start || !period_end) return NextResponse.json({ error: "Start + Ende erforderlich" }, { status: 400 });

      // Pricing config
      const { rows: configRows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
      const pricing = configRows[0]?.value || { post_price_cents: 300, backlink_price_cents: 100, membership_monthly_cents: 0 };

      // Count posts in period
      const { rows: posts } = await query(
        `SELECT COUNT(*) as cnt FROM ghostwriter_posts
         WHERE tenant_id = $1 AND is_test = false AND status != 'failed'
           AND billing_mode = 'platform'
           AND created_at >= $2 AND created_at <= $3`,
        [id, period_start, period_end]
      );
      const postCount = parseInt(posts[0].cnt) || 0;

      // Count backlinks (for now: posts with backlinks_enabled)
      const { rows: settings } = await query("SELECT backlinks_enabled FROM tenant_settings WHERE tenant_id = $1", [id]);
      const backlinkCount = settings[0]?.backlinks_enabled ? postCount : 0;

      const postTotal = postCount * pricing.post_price_cents;
      const backlinkTotal = backlinkCount * pricing.backlink_price_cents;
      const membership = pricing.membership_monthly_cents;
      const total = postTotal + backlinkTotal + membership;

      const { rows: [period] } = await query(
        `INSERT INTO billing_periods (tenant_id, period_start, period_end, status, post_count, backlink_count,
         post_total_cents, backlink_total_cents, membership_cents, total_cents, invoiced_at)
         VALUES ($1, $2, $3, 'invoiced', $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
        [id, period_start, period_end, postCount, backlinkCount, postTotal, backlinkTotal, membership, total]
      );
      return NextResponse.json({ ok: true, period });
    }

    case "update_status": {
      const { periodId, status } = body;
      await query("UPDATE billing_periods SET status = $2 WHERE id = $1", [periodId, status]);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
