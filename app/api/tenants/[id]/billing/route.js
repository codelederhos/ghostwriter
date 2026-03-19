import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createDueMembershipCycles } from "@/lib/membership.js";

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
  const pricing = await getPricing();

  // Membership-Zyklen erzeugen die seit letztem Scheduler-Lauf fällig geworden sind
  await createDueMembershipCycles(id, pricing.membership_monthly_cents || 0).catch(() => {});

  const [{ rows: periods }, { rows: rawPosts }, { rows: openCycles }, { rows: openRegens }] = await Promise.all([
    query("SELECT * FROM billing_periods WHERE tenant_id = $1 ORDER BY period_start DESC", [id]),
    query(
      `SELECT id, blog_title, category, angle, billing_mode, is_test, cost_cents, full_cost_cents, created_at
       FROM ghostwriter_posts
       WHERE tenant_id = $1 AND status != 'failed' AND billing_mode = 'platform'
         AND created_at > COALESCE(
           (SELECT period_end FROM billing_periods WHERE tenant_id = $1 AND status != 'open' ORDER BY period_end DESC LIMIT 1),
           '2020-01-01'::date
         )
       ORDER BY created_at DESC`,
      [id]
    ),
    query(
      "SELECT * FROM membership_billing_cycles WHERE tenant_id = $1 AND status = 'open' ORDER BY cycle_start",
      [id]
    ),
    query(
      `SELECT pir.*, gp.blog_title as post_title FROM post_image_regenerations pir
       JOIN ghostwriter_posts gp ON gp.id = pir.post_id
       WHERE pir.tenant_id = $1
         AND pir.created_at > COALESCE(
           (SELECT period_end FROM billing_periods WHERE tenant_id = $1 AND status != 'open' ORDER BY period_end DESC LIMIT 1),
           '2020-01-01'::date
         )
       ORDER BY pir.created_at DESC`,
      [id]
    ),
  ]);

  const testDiscount = (pricing.test_discount_percent ?? 60) / 100;
  let openTotal = 0;

  // Posts: historischer Preis aus cost_cents, full_cost_cents für Strikethrough
  const openPosts = rawPosts.map(p => {
    const calculated_price = p.cost_cents != null
      ? p.cost_cents
      : p.is_test
        ? Math.round(pricing.post_price_cents * (1 - testDiscount))
        : pricing.post_price_cents;
    openTotal += calculated_price;
    return { ...p, calculated_price };
  });

  // Membership: jeder Zyklus hat eingefrierenen Preis aus amount_cents
  const membershipTotal = openCycles.reduce((sum, c) => sum + c.amount_cents, 0);
  openTotal += membershipTotal;

  // Bild-Regenerierungen
  const regenTotal = openRegens.reduce((sum, r) => sum + r.cost_cents, 0);
  openTotal += regenTotal;

  return NextResponse.json({ pricing, periods, openPosts, openTotal, openCycles, membershipTotal, openRegens, regenTotal });
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { action, period_start, period_end, periodId, status } = await req.json();

  switch (action) {
    case "create_invoice": {
      if (!period_start || !period_end) return NextResponse.json({ error: "Start + Ende erforderlich" }, { status: 400 });

      const [pricing, { rows: posts }, { rows: settings }, { rows: membershipCycles }] = await Promise.all([
        getPricing(),
        query(
          `SELECT id, is_test, cost_cents FROM ghostwriter_posts
           WHERE tenant_id = $1 AND is_test = false AND status != 'failed'
             AND billing_mode = 'platform' AND created_at >= $2 AND created_at <= $3`,
          [id, period_start, period_end]
        ),
        query("SELECT backlinks_enabled FROM tenant_settings WHERE tenant_id = $1", [id]),
        // Membership-Zyklen die in diesen Zeitraum fallen (unabhängig von post-Logik)
        query(
          `SELECT id, amount_cents FROM membership_billing_cycles
           WHERE tenant_id = $1 AND status = 'open' AND cycle_end <= $2`,
          [id, period_end]
        ),
      ]);

      const testDiscount = (pricing.test_discount_percent ?? 60) / 100;

      // Posts: historischer Preis summieren
      const postCount = posts.length;
      const postTotal = posts.reduce((sum, p) => {
        const cents = p.cost_cents != null
          ? p.cost_cents
          : p.is_test
            ? Math.round(pricing.post_price_cents * (1 - testDiscount))
            : pricing.post_price_cents;
        return sum + cents;
      }, 0);

      const backlinkCount = settings[0]?.backlinks_enabled ? postCount : 0;
      const backlinkTotal = backlinkCount * pricing.backlink_price_cents;

      // Membership: Summe der eingefrorenen Zyklus-Preise
      const membershipTotal = membershipCycles.reduce((sum, c) => sum + c.amount_cents, 0);
      const total = postTotal + backlinkTotal + membershipTotal;

      const { rows: [period] } = await query(
        `INSERT INTO billing_periods (tenant_id, period_start, period_end, status, post_count, backlink_count,
         post_total_cents, backlink_total_cents, membership_cents, total_cents, invoiced_at)
         VALUES ($1, $2, $3, 'invoiced', $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
        [id, period_start, period_end, postCount, backlinkCount, postTotal, backlinkTotal, membershipTotal, total]
      );

      // Membership-Zyklen als abgerechnet markieren
      if (membershipCycles.length > 0) {
        await query(
          `UPDATE membership_billing_cycles SET status = 'invoiced', billing_period_id = $1
           WHERE id = ANY($2::uuid[])`,
          [period.id, membershipCycles.map(c => c.id)]
        );
      }

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
