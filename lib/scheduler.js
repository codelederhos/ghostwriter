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

  // Every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    console.log("[Scheduler] Checking for due tenants...");
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3200";
      const res = await fetch(`${baseUrl}/api/autopilot/run-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": "internal",
        },
      });
      const data = await res.json();
      console.log(`[Scheduler] Processed ${data.processed || 0} tenants`);
    } catch (err) {
      console.error("[Scheduler] Error:", err.message);
    }
  });

  console.log("[Scheduler] Started. Checking every 30 minutes.");
}
