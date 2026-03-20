/**
 * Google Drive API Helper
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * List image files in a Drive folder
 * @returns {Array<{id, name, mimeType, size, thumbnailLink}>}
 */
export async function listDriveImages(accessToken, folderId) {
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`;
  const fields = "files(id,name,mimeType,size,thumbnailLink,createdTime)";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.files || [];
}

/**
 * List folders in Drive (top-level or inside a parent)
 * @returns {Array<{id, name}>}
 */
export async function listDriveFolders(accessToken, parentId = null) {
  let q = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=50&orderBy=name`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.files || [];
}

/**
 * Download a Drive file and save to local uploads directory.
 * Returns the public URL path (relative to NEXT_PUBLIC_BASE_URL).
 */
export async function downloadDriveFile(accessToken, fileId, tenantId, mimeType = "image/jpeg") {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive download ${res.status}`);

  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const filename = `${fileId}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", "drive", tenantId);

  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return `/uploads/drive/${tenantId}/${filename}`;
}

/**
 * Get folder metadata (name) by ID
 */
export async function getDriveFolderName(accessToken, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.name || null;
}
