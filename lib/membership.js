/**
 * Membership Billing Cycle Manager
 *
 * Erzeugt wöchentliche (7-Tage) Abrechnungszyklen für Tenants im Platform-Mode.
 * Preis wird beim Erstellen des Zyklus eingefroren — spätere Preisänderungen
 * betreffen nur neue Zyklen, nie bereits erzeugte.
 */

import { query } from "./db.js";

const CYCLE_DAYS = 7;

/**
 * Erzeugt alle fälligen Membership-Zyklen für einen Tenant.
 * Wird vom Scheduler (run-all) aufgerufen.
 *
 * @param {string} tenantId
 * @param {number} membershipCents - Aktueller Preis (wird eingefroren)
 */
export async function createDueMembershipCycles(tenantId, membershipCents) {
  if (!membershipCents || membershipCents <= 0) return;

  const { rows: [settings] } = await query(
    "SELECT membership_start_date FROM tenant_settings WHERE tenant_id = $1",
    [tenantId]
  );

  let startDate = settings?.membership_start_date
    ? new Date(settings.membership_start_date)
    : null;

  // Auto-init: Startdatum = Tenant-Erstellungsdatum
  if (!startDate) {
    const { rows: [tenant] } = await query(
      "SELECT created_at FROM tenants WHERE id = $1",
      [tenantId]
    );
    if (!tenant) return;
    startDate = new Date(tenant.created_at);
    await query(
      "UPDATE tenant_settings SET membership_start_date = $1 WHERE tenant_id = $2",
      [startDate.toISOString().split("T")[0], tenantId]
    );
  }

  // Letzten vorhandenen Zyklus laden
  const { rows: [lastCycle] } = await query(
    "SELECT cycle_end FROM membership_billing_cycles WHERE tenant_id = $1 ORDER BY cycle_end DESC LIMIT 1",
    [tenantId]
  );

  // Nächsten Zyklus-Start bestimmen
  let nextStart = lastCycle
    ? (() => { const d = new Date(lastCycle.cycle_end); d.setDate(d.getDate() + 1); return d; })()
    : new Date(startDate);

  // Heute (ohne Uhrzeit)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Alle fälligen Zyklen erzeugen (cycle_end muss <= heute sein)
  while (true) {
    const cycleEnd = new Date(nextStart);
    cycleEnd.setDate(cycleEnd.getDate() + CYCLE_DAYS - 1);

    if (cycleEnd > today) break;

    const startStr = nextStart.toISOString().split("T")[0];
    const endStr = cycleEnd.toISOString().split("T")[0];

    // ON CONFLICT (tenant_id, cycle_start) DO NOTHING — kein Duplikat möglich
    await query(
      `INSERT INTO membership_billing_cycles (tenant_id, cycle_start, cycle_end, amount_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, cycle_start) DO NOTHING`,
      [tenantId, startStr, endStr, membershipCents]
    );

    nextStart = new Date(cycleEnd);
    nextStart.setDate(nextStart.getDate() + 1);
  }
}
