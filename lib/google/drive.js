/**
 * Google Drive API — Service Account basiert (kein OAuth nötig)
 * Bilder werden als WebP konvertiert (max 1600px) + Thumbnail (400px).
 */

import { createSign } from "crypto";
import { readFile, mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import sharp from "sharp";

export const SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "ghostwriter-drive@ghostwriter-490820.iam.gserviceaccount.com";

// In-memory Token-Cache (pro Server-Instanz)
let _saToken = null;
let _saExpiry = 0;

async function getServiceAccountToken() {
  if (_saToken && Date.now() < _saExpiry - 60_000) return _saToken;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!keyPath) throw new Error("GOOGLE_SERVICE_ACCOUNT env var nicht gesetzt");

  const key = JSON.parse(await readFile(keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(key.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${sig}`,
    }),
  });

  if (!res.ok) throw new Error(`SA Token fehlgeschlagen: ${await res.text()}`);
  const data = await res.json();
  _saToken = data.access_token;
  _saExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _saToken;
}

/**
 * Bilder in einem Drive-Ordner auflisten — rekursiv (alle Sub-Ordner)
 */
export async function listDriveImages(folderId) {
  const token = await getServiceAccountToken();
  return _listImagesRecursive(token, folderId);
}

async function _listImagesRecursive(token, folderId) {
  const subQ = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQ)}&fields=files(id)&pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subFolders = subRes.ok ? ((await subRes.json()).files || []) : [];

  const imgQ = `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`;
  const fields = "files(id,name,mimeType,size,createdTime)";
  const imgRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(imgQ)}&fields=${encodeURIComponent(fields)}&pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!imgRes.ok) throw new Error(`Drive API ${imgRes.status}: ${await imgRes.text()}`);
  const images = (await imgRes.json()).files || [];

  const subImages = await Promise.all(subFolders.map(f => _listImagesRecursive(token, f.id)));
  return images.concat(...subImages);
}

/**
 * Datei downloaden, in WebP konvertieren + Thumbnail erstellen.
 * Gibt { url, thumbUrl } zurück (relative public paths).
 */
export async function downloadAndConvertDriveFile(fileId, tenantId) {
  const token = await getServiceAccountToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.join(process.cwd(), "public", "uploads", "drive", tenantId);
  await mkdir(dir, { recursive: true });

  // Haupt-Bild: WebP max 1600px
  await sharp(buffer)
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(path.join(dir, `${fileId}.webp`));

  // Thumbnail: 400×400 WebP
  await sharp(buffer)
    .resize(400, 400, { fit: "cover" })
    .webp({ quality: 75 })
    .toFile(path.join(dir, `${fileId}_thumb.webp`));

  return {
    url: `/uploads/drive/${tenantId}/${fileId}.webp`,
    thumbUrl: `/uploads/drive/${tenantId}/${fileId}_thumb.webp`,
  };
}

/**
 * Ordner-Namen per ID abrufen (Validierung ob SA Zugriff hat)
 */
export async function getDriveFolderName(folderId) {
  const token = await getServiceAccountToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return (await res.json()).name || null;
}
