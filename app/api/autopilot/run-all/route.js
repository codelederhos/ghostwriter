import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline/index.js";
import { sendTelegramAlert } from "@/lib/reporters/telegram.js";
import { decrypt } from "@/lib/crypto.js";
import { createDueMembershipCycles } from "@/lib/membership.js";
import { checkCronSecret } from "@/lib/cron-auth.js";

/**
 * Scheduler endpoint: runs all tenants that are due
 * Called by node-cron every 30 minutes
 */
export async function POST(req) {
  // Auth via secret header (for cron) or admin session
  if (!checkCronSecret(req)) {
    const { requireAdmin } = await import("@/lib/auth");
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 'auto'-Tenants publizieren direkt. 'review'-Tenants erzeugen im gleichen
  // Takt (frequency_hours) einen Draft in der Telegram-Freigabe — nie live,
  // reviewMode unten erzwingt draft_review. (Stani 14.07.2026: tägliche
  // Artikel für alle Tenants; Scout-Kandidaten kommen on top.)
  const { rows: dueTenants } = await query(
    `SELECT t.id, t.name, ts.telegram_bot_token, ts.telegram_chat_id,
            COALESCE(NULLIF(ts.publish_mode, ''), 'auto') AS publish_mode
     FROM tenants t
     JOIN tenant_settings ts ON ts.tenant_id = t.id
     WHERE ts.is_active = true
       AND t.status = 'active'
       AND COALESCE(NULLIF(ts.publish_mode, ''), 'auto') IN ('auto', 'review')
       AND (ts.next_run_at IS NULL OR ts.next_run_at <= NOW())`
  );

  const results = [];

  for (const tenant of dueTenants) {
    try {
      // Atomarer Claim: next_run_at SOFORT fortschreiben, bevor die Pipeline
      // startet — verhindert Doppel-Läufe durch parallele/schnelle Scheduler-Ticks
      // (die Pipeline läuft Minuten, der finale next_run_at-Write kam zu spät).
      const { rows: claimed } = await query(
        `UPDATE tenant_settings
         SET next_run_at = NOW() + (COALESCE(frequency_hours, 72) || ' hours')::interval
         WHERE tenant_id = $1 AND (next_run_at IS NULL OR next_run_at <= NOW())
         RETURNING tenant_id`,
        [tenant.id]
      );
      if (!claimed.length) continue; // ein anderer Lauf hat diesen Tenant schon geclaimt

      // Sicherheit: nur Tenants mit publish_mode='auto' veröffentlichen automatisch.
      // Default 'review' → Draft geht in die Freigabe-Strecke (Telegram), kein Live-Publish.
      const reviewMode = (tenant.publish_mode || "review") !== "auto";
      const result = await runPipeline(tenant.id, { reviewMode });
      results.push({ tenantId: tenant.id, name: tenant.name, status: "success", reviewMode, ...result });
    } catch (err) {
      console.error(`[Scheduler] Failed for ${tenant.name}:`, err.message);
      results.push({ tenantId: tenant.id, name: tenant.name, status: "error", error: err.message });

      // Send alert if Telegram configured
      if (tenant.telegram_bot_token && tenant.telegram_chat_id) {
        try {
          const token = decrypt(tenant.telegram_bot_token);
          await sendTelegramAlert(token, tenant.telegram_chat_id, tenant.name, err.message);
        } catch { /* ignore alert failure */ }
      }
    }
  }

  // Membership-Zyklen für alle aktiven Platform-Tenants erzeugen
  // (unabhängig davon ob heute ein Post-Run fällig ist)
  try {
    const { rows: platformTenants } = await query(
      `SELECT ts.tenant_id, sc.value->>'membership_monthly_cents' as membership_cents
       FROM tenant_settings ts
       JOIN tenants t ON t.id = ts.tenant_id
       JOIN system_config sc ON sc.key = 'pricing'
       WHERE t.status = 'active' AND ts.billing_mode = 'platform'`
    );
    for (const pt of platformTenants) {
      const cents = parseInt(pt.membership_cents) || 0;
      if (cents > 0) {
        await createDueMembershipCycles(pt.tenant_id, cents).catch(e =>
          console.error("[Membership Cycles]", e.message)
        );
      }
    }
  } catch (e) {
    console.error("[Membership Cycles Scheduler]", e.message);
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
