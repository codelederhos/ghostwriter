/**
 * Cron Scheduler
 * Runs inside the Next.js server process via instrumentation
 * Checks every 30 minutes which tenants are due
 */

import cron from "node-cron";

let scheduled = false;

export function startScheduler() {
  if (scheduled) return;
  scheduled = true;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3200";

  // Every 30 minutes: check which tenants are due for content
  cron.schedule("*/30 * * * *", async () => {
    console.log("[Scheduler] Checking for due tenants...");
    try {
      const res = await fetch(`${baseUrl}/api/autopilot/run-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": "internal" },
      });
      const data = await res.json();
      console.log(`[Scheduler] Processed ${data.processed || 0} tenants`);
    } catch (err) {
      console.error("[Scheduler] Error:", err.message);
    }
  });

  // Daily at 03:00: sync Drive images for all tenants
  cron.schedule("0 3 * * *", async () => {
    console.log("[Scheduler] Daily Drive Sync...");
    try {
      const res = await fetch(`${baseUrl}/api/autopilot/sync-drive`, {
        method: "POST",
        headers: { "x-cron-secret": "internal" },
      });
      const data = await res.json();
      console.log(`[Scheduler] Drive Sync: ${data.totalAdded || 0} neue Bilder gesamt`);
    } catch (err) {
      console.error("[Scheduler] Drive Sync Error:", err.message);
    }
  });

  console.log("[Scheduler] Started. Content-Check alle 30 Min, Drive-Sync täglich 03:00 Uhr.");
}
