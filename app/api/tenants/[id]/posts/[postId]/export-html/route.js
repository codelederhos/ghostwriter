import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateBlogHtml } from "@/lib/utils/blog-html-export";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenantId, postId } = params;

  const { rows: [post] } = await query(
    "SELECT * FROM ghostwriter_posts WHERE id = $1 AND tenant_id = $2",
    [postId, tenantId]
  );
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

  const { rows: [tenant] } = await query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
  const { rows: [profile] } = await query("SELECT * FROM tenant_profiles WHERE tenant_id = $1", [tenantId]);

  // hreflang alternates laden
  const { rows: alternates } = await query(
    `SELECT language, blog_slug FROM ghostwriter_posts
     WHERE tenant_id = $1 AND category = $2 AND angle = $3 AND season = $4 AND status = 'published'`,
    [tenantId, post.category, post.angle, post.season]
  );

  // Test-Post: Info zurückgeben damit Admin Upgrade-Modal zeigen kann
  if (post.is_test) {
    const { rows: sysRows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
    const pricing = sysRows[0]?.value ? JSON.parse(sysRows[0].value) : {};
    const postPrice = pricing.post_price_cents ?? 300;
    const testDiscount = (pricing.test_discount_percent ?? 60) / 100;
    const testPaid = Math.round(postPrice * (1 - testDiscount));
    const upgradeCents = postPrice - testPaid;

    // ?upgrade=1 → Test-Post upgraden + HTML zurückgeben
    const url = new URL(req.url);
    if (url.searchParams.get("upgrade") === "1") {
      await query(
        `UPDATE ghostwriter_posts SET is_test = false, cost_cents = $2, updated_at = NOW() WHERE id = $1`,
        [postId, postPrice]
      );
      post.is_test = false;
      // Billing-Eintrag für Differenz
      await query(
        `INSERT INTO ghostwriter_log (tenant_id, post_id, step, status, message, duration_ms)
         VALUES ($1, $2, 'export-upgrade', 'success', $3, 0)`,
        [tenantId, postId, `Test→Vollpost Upgrade: ${upgradeCents} Cent nachberechnet`]
      );
    } else {
      // Nur Info zurückgeben — kein HTML
      return NextResponse.json({
        isTest: true,
        postId,
        postTitle: post.blog_title,
        testPaidCents: testPaid,
        fullPriceCents: postPrice,
        upgradeCents,
      });
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  const html = generateBlogHtml(post, profile, tenant, alternates, baseUrl);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${post.blog_slug}.html"`,
    },
  });
}
