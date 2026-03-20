/**
 * POST /api/autopilot/sync-drive
 * Syncs Drive images for all tenants with drive_enabled = true.
 * Called by the scheduler once per day.
 */
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { listDriveImages, downloadAndConvertDriveFile } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== "internal") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows: tenants } = await query(
    `SELECT ts.tenant_id, ts.drive_folder_id
     FROM tenant_settings ts
     WHERE ts.drive_enabled = true AND ts.drive_folder_id IS NOT NULL`
  );

  let totalAdded = 0;
  const results = [];

  for (const { tenant_id, drive_folder_id } of tenants) {
    try {
      const files = await listDriveImages(drive_folder_id);
      let added = 0;

      for (const file of files) {
        const { rows: existing } = await query(
          "SELECT id FROM tenant_reference_images WHERE tenant_id = $1 AND source_id = $2",
          [tenant_id, file.id]
        );
        if (existing.length > 0) continue;

        let urls;
        try {
          urls = await downloadAndConvertDriveFile(file.id, tenant_id);
        } catch (err) {
          console.error(`[Drive Sync] Download fehlgeschlagen ${file.id}:`, err.message);
          continue;
        }

        const base = process.env.NEXT_PUBLIC_BASE_URL || "";
        await query(
          `INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, source, source_id)
           VALUES ($1, 'post', $2, $3, $4, 'drive', $5)`,
          [tenant_id, base + urls.url, base + urls.thumbUrl, file.name, file.id]
        );
        added++;
      }

      totalAdded += added;
      results.push({ tenant_id, added, total: files.length });
      console.log(`[Drive Sync] ${tenant_id}: ${added} neue Bilder`);
    } catch (err) {
      console.error(`[Drive Sync] Fehler für ${tenant_id}:`, err.message);
      results.push({ tenant_id, error: err.message });
    }
  }

  return NextResponse.json({ ok: true, totalAdded, results });
}
