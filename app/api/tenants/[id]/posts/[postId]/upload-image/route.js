import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "posts");
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

const SIZES = [
  { suffix: "-thumb", width: 400, quality: 75 },
  { suffix: "", width: 1200, quality: 85 },
];

// POST: Datei hochladen, neues Bild fuer Post setzen,
// optional als Eintrag in tenant_reference_images speichern.
export async function POST(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenantId, postId } = params;

  const { rows: [post] } = await query(
    "SELECT id FROM ghostwriter_posts WHERE id = $1 AND tenant_id = $2",
    [postId, tenantId]
  );
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file) return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Max 25 MB" }, { status: 400 });

  const addToCollection = formData.get("add_to_collection") === "true";
  const description = (formData.get("description") || "").toString().trim() || null;

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const urls = {};
  for (const size of SIZES) {
    const filename = `${baseName}${size.suffix}.webp`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await sharp(buffer)
      .resize(size.width, null, { withoutEnlargement: true })
      .webp({ quality: size.quality })
      .toFile(filepath);
    urls[size.suffix || "full"] = `/uploads/posts/${filename}`;
  }

  // Post aktualisieren
  await query(
    "UPDATE ghostwriter_posts SET image_url = $1 WHERE id = $2",
    [urls.full, postId]
  );

  // Optional: in tenant_reference_images speichern (Schema: image_url, thumb_url, description, type, approval_status)
  let savedImageId = null;
  if (addToCollection) {
    try {
      const { rows: [img] } = await query(
        "INSERT INTO tenant_reference_images (tenant_id, type, image_url, thumb_url, description, approval_status) VALUES ($1, 'post', $2, $3, $4, 'approved') RETURNING id",
        [tenantId, urls.full, urls["-thumb"], description]
      );
      savedImageId = img?.id || null;
    } catch (e) {
      // Sammlung-Insert ist optional, Upload selbst war erfolgreich
    }
  }

  return NextResponse.json({
    ok: true,
    image_url: urls.full,
    thumb_url: urls["-thumb"],
    collection_image_id: savedImageId,
  });
}
