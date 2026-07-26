import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getDraftPost, postPayload, splitSections } from "../../_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/drafts/[id]/image
 * Body: { url: string, alt?: string }
 * Setzt Hero-Bild (image_url) und optional image_alt_text.
 */
export async function PATCH(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ ok: false, error: "url_required" }, { status: 400 });
  if (!/^(https?:\/\/|\/)/i.test(url)) {
    return NextResponse.json({ ok: false, error: "url_invalid", detail: "Nur http(s)-URLs oder relative Pfade erlaubt." }, { status: 400 });
  }
  const alt = typeof body?.alt === "string" ? body.alt.trim() : null;

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (alt !== null) {
    await query(
      "UPDATE ghostwriter_posts SET image_url = $2, image_alt_text = $3, updated_at = NOW() WHERE id = $1",
      [params.id, url, alt || null]
    );
  } else {
    await query(
      "UPDATE ghostwriter_posts SET image_url = $2, updated_at = NOW() WHERE id = $1",
      [params.id, url]
    );
  }

  const fresh = await getDraftPost(params.id);
  return NextResponse.json({
    ok: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
