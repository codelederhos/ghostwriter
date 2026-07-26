import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { loadTenant } from "@/lib/pipeline/index";
import { generateImage } from "@/lib/providers/image";
import { getDraftPost, postPayload, splitSections } from "../../_lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/drafts/[id]/generate-image
 * Body: { prompt: string }
 * Generiert ein neues Hero-Bild ueber den Tenant-Bild-Provider (loadTenant +
 * generateImage) und setzt image_url am Post.
 */
export async function POST(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const prompt = String(body?.prompt || "").trim();
  if (prompt.length < 10) {
    return NextResponse.json({ ok: false, error: "prompt_too_short", min: 10 }, { status: 400 });
  }

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  let settings;
  try {
    ({ settings } = await loadTenant(post.tenant_id));
  } catch (e) {
    return NextResponse.json({ ok: false, error: "tenant_load_failed", detail: e.message }, { status: 500 });
  }

  const slug = `${post.blog_slug || post.id}-review`;
  let result;
  try {
    result = await generateImage(settings, prompt, slug, { format: "landscape" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "image_generation_failed", detail: e.message }, { status: 502 });
  }

  const imageUrl = result?.url || result?.localPath;
  if (!imageUrl) return NextResponse.json({ ok: false, error: "no_image_url" }, { status: 502 });

  await query(
    "UPDATE ghostwriter_posts SET image_url = $2, updated_at = NOW() WHERE id = $1",
    [params.id, imageUrl]
  );

  const fresh = await getDraftPost(params.id);
  return NextResponse.json({
    ok: true,
    image_url: imageUrl,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
