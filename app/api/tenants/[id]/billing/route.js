import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_PRICING = { post_price_cents: 300, backlink_price_cents: 100, membership_monthly_cents: 0, test_discount_percent: 60 };

async function getPricing() {
  const { rows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
  return { ...DEFAULT_PRICING, ...(rows[0]?.value || {}) };
}

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;

  const [pricing, { rows: periods }, { rows: rawPosts }] = await Promise.all([
    getPricing(),
    query("SELECT * FROM billing_periods WHERE tenant_id = $1 ORDER BY period_start DESC", [id]),
    query(
      `SELECT id, blog_title, category, angle, billing_mode, is_test, cost_cents, created_at
       FROM ghostwriter_posts
       WHERE tenant_id = $1 AND status != 'failed' AND billing_mode = 'platform'
         AND created_at > COALESCE(
           (SELECT period_end FROM billing_periods WHERE tenant_id = $1 AND status != 'open' ORDER BY period_end DESC LIMIT 1),
           '2020-01-01'::date
         )
       ORDER BY created_at DESC`,
      [id]
    ),
  ]);

  const testDiscount = (pricing.test_discount_percent ?? 60) / 100;
  let openTotal = 0;
  const openPosts = rawPosts.map(p => {
    const calculated_price = p.is_test
      ? Math.round(pricing.post_price_cents * (1 - testDiscount))
      : pricing.post_price_cents;
    openTotal += calculated_price;
    return { ...p, calculated_price };
  });

  return NextResponse.json({ pricing, periods, openPosts, openTotal });
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { action, period_start, period_end, periodId, status } = await req.json();

  switch (action) {
    case "create_invoice": {
      if (!period_start || !period_end) return NextResponse.json({ error: "Start + Ende erforderlich" }, { status: 400 });

      const [pricing, { rows: posts }, { rows: settings }] = await Promise.all([
        getPricing(),
        query(
          `SELECT COUNT(*) as cnt FROM ghostwriter_posts
           WHERE tenant_id = $1 AND is_test = false AND status != 'failed'
             AND billing_mode = 'platform' AND created_at >= $2 AND created_at <= $3`,
          [id, period_start, period_end]
        ),
        query("SELECT backlinks_enabled FROM tenant_settings WHERE tenant_id = $1", [id]),
      ]);

      const postCount = parseInt(posts[0].cnt) || 0;
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
      await query("UPDATE billing_periods SET status = $2 WHERE id = $1", [periodId, status]);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
