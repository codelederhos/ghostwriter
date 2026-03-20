/**
 * Google Integration API für einen Tenant
 * GET  → Verbindungsstatus (GBP OAuth) + Drive-Status
 * POST → set_folder | sync_drive | set_gbp | disconnect | toggle_drive | toggle_gbp | post_to_gbp
 *
 * Drive: Service Account (kein OAuth nötig, SA-Email muss Zugriff auf Ordner haben)
 * GBP:   OAuth 2.0 (User-Account, für Posting nötig)
 */
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { getValidGoogleToken, fetchGbpAccountsAndLocations } from "@/lib/google/oauth";
import { listDriveImages, downloadDriveFile, getDriveFolderName, SERVICE_ACCOUNT_EMAIL } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

function decryptSettings(s) {
  return {
    ...s,
    gbp_oauth_token: s.gbp_oauth_token ? decrypt(s.gbp_oauth_token) : null,
    gbp_refresh_token: s.gbp_refresh_token ? decrypt(s.gbp_refresh_token) : null,
  };
}

// ─── GET: Status ──────────────────────────────────────────────────────────────
export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { rows: [raw] } = await query("SELECT * FROM tenant_settings WHERE tenant_id = $1", [id]);
  if (!raw) return NextResponse.json({ gbpConnected: false });

  const settings = decryptSettings(raw);
  const gbpConnected = !!(settings.gbp_oauth_token && settings.gbp_refresh_token);

  const result = {
    // Drive (Service Account — immer verfügbar)
    driveAvailable: !!process.env.GOOGLE_SERVICE_ACCOUNT,
    serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
    driveEnabled: !!settings.drive_enabled,
    driveFolderId: settings.drive_folder_id || null,
    driveFolderName: settings.drive_folder_name || null,

    // GBP (OAuth)
    gbpConnected,
    gbpEnabled: !!settings.gbp_enabled,
    gbpAccountId: settings.gbp_account_id || null,
    gbpLocationId: settings.gbp_location_id || null,
    scopes: settings.google_scopes || "",
    tokenExpiry: settings.google_token_expiry,
  };

  // GBP Accounts laden wenn verbunden
  if (gbpConnected) {
    try {
      const token = await getValidGoogleToken(id, settings);
      try { result.gbpAccounts = await fetchGbpAccountsAndLocations(token); } catch { result.gbpAccounts = []; }
    } catch (err) {
      result.tokenError = err.message;
    }
  }

  return NextResponse.json(result);
}

// ─── POST: Aktionen ───────────────────────────────────────────────────────────
export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { action } = body;

  const { rows: [raw] } = await query("SELECT * FROM tenant_settings WHERE tenant_id = $1", [id]);
  if (!raw) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const settings = decryptSettings(raw);

  switch (action) {

    // ── Drive-Ordner setzen (SA holt den Namen) ─────────────────────────────
    case "set_folder": {
      const { folderId } = body;
      let folderName = body.folderName || null;

      if (!folderName && folderId) {
        try { folderName = await getDriveFolderName(folderId); } catch { /* non-fatal */ }
      }

      await query(
        `UPDATE tenant_settings SET drive_folder_id = $2, drive_folder_name = $3, updated_at = NOW() WHERE tenant_id = $1`,
        [id, folderId || null, folderName]
      );
      return NextResponse.json({ ok: true, folderName });
    }

    // ── Drive-Bilder synchronisieren ────────────────────────────────────────
    case "sync_drive": {
      const folderId = settings.drive_folder_id;
      if (!folderId) return NextResponse.json({ error: "Kein Drive-Ordner gesetzt" }, { status: 400 });

      const files = await listDriveImages(folderId);
      let added = 0, skipped = 0;

      for (const file of files) {
        const { rows: existing } = await query(
          "SELECT id FROM tenant_reference_images WHERE tenant_id = $1 AND source_id = $2",
          [id, file.id]
        );
        if (existing.length > 0) { skipped++; continue; }

        let localUrl;
        try {
          localUrl = await downloadDriveFile(file.id, id, file.mimeType);
        } catch (err) {
          console.error(`[Drive Sync] Download fehlgeschlagen ${file.id}:`, err.message);
          continue;
        }

        const publicUrl = `${process.env.NEXT_PUBLIC_BASE_URL || ""}${localUrl}`;
        await query(
          `INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, source, source_id)
           VALUES ($1, 'post', $2, $3, $4, 'drive', $5)`,
          [id, publicUrl, file.thumbnailLink || publicUrl, file.name, file.id]
        );
        added++;
      }

      return NextResponse.json({ ok: true, added, skipped, total: files.length });
    }

    // ── GBP Account + Standort setzen ──────────────────────────────────────
    case "set_gbp": {
      const { accountId, locationId } = body;
      await query(
        `UPDATE tenant_settings SET gbp_account_id = $2, gbp_location_id = $3, updated_at = NOW() WHERE tenant_id = $1`,
        [id, accountId || null, locationId || null]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Toggles ─────────────────────────────────────────────────────────────
    case "toggle_drive": {
      await query(
        `UPDATE tenant_settings SET drive_enabled = $2, updated_at = NOW() WHERE tenant_id = $1`,
        [id, !!body.enabled]
      );
      return NextResponse.json({ ok: true });
    }

    case "toggle_gbp": {
      await query(
        `UPDATE tenant_settings SET gbp_enabled = $2, updated_at = NOW() WHERE tenant_id = $1`,
        [id, !!body.enabled]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Manuell auf GBP posten ──────────────────────────────────────────────
    case "post_to_gbp": {
      const { postId } = body;
      const { rows: [post] } = await query(
        "SELECT * FROM ghostwriter_posts WHERE id = $1 AND tenant_id = $2",
        [postId, id]
      );
      if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

      const token = await getValidGoogleToken(id, settings);
      const accountLocation = `accounts/${settings.gbp_account_id}/locations/${settings.gbp_location_id}`;
      const { rows: [tenant] } = await query("SELECT * FROM tenants WHERE id = $1", [id]);
      const blogUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;

      const gbpBody = {
        languageCode: post.language,
        summary: post.gbp_text,
        callToAction: { actionType: "LEARN_MORE", url: blogUrl },
        topicType: "STANDARD",
      };
      if (post.image_url) gbpBody.media = [{ mediaFormat: "PHOTO", sourceUrl: post.image_url }];

      const gbpRes = await fetch(
        `https://mybusiness.googleapis.com/v4/${accountLocation}/localPosts`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(gbpBody),
        }
      );

      if (!gbpRes.ok) {
        const err = await gbpRes.text();
        return NextResponse.json({ error: `GBP ${gbpRes.status}: ${err}` }, { status: 502 });
      }

      const gbpData = await gbpRes.json();
      await query("UPDATE ghostwriter_posts SET gbp_post_id = $2 WHERE id = $1", [postId, gbpData.name || null]);
      return NextResponse.json({ ok: true, gbpPostId: gbpData.name });
    }

    // ── GBP-Verbindung trennen ───────────────────────────────────────────────
    case "disconnect": {
      await query(
        `UPDATE tenant_settings SET
           gbp_oauth_token = NULL, gbp_refresh_token = NULL,
           google_token_expiry = NULL, google_scopes = NULL,
           gbp_enabled = false, updated_at = NOW()
         WHERE tenant_id = $1`,
        [id]
      );
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unbekannte Aktion: ${action}` }, { status: 400 });
  }
}
