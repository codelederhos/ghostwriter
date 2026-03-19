/**
 * Content Refresh Cron Endpoint
 * Wird vom Scheduler alle 24h aufgerufen (zusätzlich zum normalen run-all).
 * Prüft Posts > 180 Tage alt bei Tenants mit refresh_enabled = true.
 * Max. 1 Post pro Tenant pro Lauf (Kostenkontrolle).
 *
 * Auth: x-cron-secret Header (identisch zu run-all)
 * Preis: post_price_cents * (1 - refresh_discount_percent/100) aus system_config.pricing
 */
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/crypto.js";
import { runRefresher } from "@/lib/pipeline/steps/refresher.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET && cronSecret !== "internal") {
    const { requireAdmin } = await import("@/lib/auth");
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Preise laden
  const { rows: sysRows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
  const pricing = sysRows[0]?.value ? JSON.parse(sysRows[0].value) : {};
  const postPrice = pricing.post_price_cents ?? 300;
  const refreshDiscount = (pricing.refresh_discount_percent ?? 40) / 100;
  const refreshCostCents = Math.round(postPrice * (1 - refreshDiscount));

  // Tenants mit refresh_enabled
  const { rows: tenants } = await query(
    `SELECT t.id, t.name, t.slug, ts.billing_mode
     FROM tenants t
     JOIN tenant_settings ts ON ts.tenant_id = t.id
     WHERE t.status = 'active' AND ts.refresh_enabled = true`
  );

  const results = [];

  for (const tenant of tenants) {
    try {
      // Ältester eligible Post des Tenants (> 180 Tage, noch nicht heute refreshed)
      const { rows: [post] } = await query(
        `SELECT p.*, tp.industry, tp.region, tp.company_name, tp.brand_voice, tp.website_url
         FROM ghostwriter_posts p
         JOIN tenant_profiles tp ON tp.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1
           AND p.status = 'published'
           AND p.published_at < NOW() - INTERVAL '180 days'
           AND (p.refreshed_at IS NULL OR p.refreshed_at < NOW() - INTERVAL '180 days')
         ORDER BY p.published_at ASC
         LIMIT 1`,
        [tenant.id]
      );

      if (!post) {
        results.push({ tenantId: tenant.id, name: tenant.name, status: "skipped", reason: "no eligible posts" });
        continue;
      }

      // Settings laden + entschlüsseln
      const { rows: [rawSettings] } = await query(
        "SELECT * FROM tenant_settings WHERE tenant_id = $1", [tenant.id]
      );
      const settings = { ...rawSettings };
      for (const field of ["text_api_key", "image_api_key", "gbp_oauth_token", "gbp_refresh_token"]) {
        if (settings[field]) { try { settings[field] = decrypt(settings[field]); } catch { /* leave */ } }
      }

      // Platform-Mode
      if (settings.billing_mode === "platform") {
        settings.text_api_key = process.env.ANTHROPIC_API_KEY;
        settings.text_provider = "anthropic";
      }

      const profile = {
        industry: post.industry, region: post.region,
        company_name: post.company_name, brand_voice: post.brand_voice,
        website_url: post.website_url,
      };

      // Refresh ausführen
      const refreshed = await runRefresher(settings, post, profile);
      if (!refreshed) {
        results.push({ tenantId: tenant.id, postId: post.id, status: "skipped", reason: "refresher returned null" });
        continue;
      }

      // Post updaten
      await query(
        `UPDATE ghostwriter_posts SET
           blog_body = COALESCE($2, blog_body),
           blog_title = COALESCE($3, blog_title),
           blog_meta_description = COALESCE($4, blog_meta_description),
           gbp_text = COALESCE($5, gbp_text),
           refreshed_at = NOW(),
           updated_at = NOW(),
           refresh_count = refresh_count + 1
         WHERE id = $1`,
        [post.id, refreshed.body_html, refreshed.blog_title || null, refreshed.meta_description || null, refreshed.gbp_text || null]
      );

      // Billing-Eintrag (Platform-Mode)
      if (tenant.billing_mode === "platform") {
        await query(
          `INSERT INTO ghostwriter_log (tenant_id, post_id, step, status, message, duration_ms)
           VALUES ($1, $2, 'refresh', 'success', $3, 0)`,
          [tenant.id, post.id, `Content-Refresh: ${refreshCostCents} Cent (${Math.round((1-refreshDiscount)*100)}% des Normalpreises)`]
        );
      }

      results.push({ tenantId: tenant.id, name: tenant.name, postId: post.id, title: post.blog_title, status: "refreshed", costCents: refreshCostCents });
    } catch (err) {
      console.error(`[Refresh] Failed for ${tenant.name}:`, err.message);
      results.push({ tenantId: tenant.id, name: tenant.name, status: "error", error: err.message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
