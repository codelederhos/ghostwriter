import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// PATCH: Bild aus Sammlung waehlen oder direkt eine URL setzen
export async function PATCH(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenantId, postId } = params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const imageUrl = (body.image_url || "").trim();
  if (!imageUrl) return NextResponse.json({ error: "image_url fehlt" }, { status: 400 });

  // Sicherstellen, dass Post zu diesem Tenant gehoert
  const { rows: [post] } = await query(
    "SELECT id FROM ghostwriter_posts WHERE id = $1 AND tenant_id = $2",
    [postId, tenantId]
  );
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

  await query(
    "UPDATE ghostwriter_posts SET image_url = $1 WHERE id = $2",
    [imageUrl, postId]
  );

  return NextResponse.json({ ok: true, image_url: imageUrl });
}
