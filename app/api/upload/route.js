import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "refs");
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

// Größen: Vorschau (400px) + Full (1200px)
const SIZES = [
  { suffix: "-thumb", width: 400, quality: 75 },
  { suffix: "", width: 1200, quality: 85 },
];

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Max 25 MB" }, { status: 400 });

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

    urls[size.suffix || "full"] = `/uploads/refs/${filename}`;
  }

  return NextResponse.json({
    ok: true,
    url: urls.full,       // 1200px für Vollansicht
    thumb: urls["-thumb"], // 400px für Vorschau
  });
}
