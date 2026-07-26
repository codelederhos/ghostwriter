import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getDraftPost, postPayload, splitSections, parseMaybeJson } from "../../_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/drafts/[id]/social
 * Body: { linkedin?, facebook?, instagram?, gbp_text? }
 * linkedin/facebook/instagram werden ins social_text-JSONB gemergt,
 * gbp_text ist eine eigene Spalte. Liefert post + sections zurueck.
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

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const social = parseMaybeJson(post.social_text, {}) || {};
  let socialChanged = false;
  for (const platform of ["linkedin", "facebook", "instagram"]) {
    if (typeof body[platform] === "string") {
      social[platform] = body[platform].trim();
      socialChanged = true;
    }
  }
  const gbpChanged = typeof body.gbp_text === "string";

  if (!socialChanged && !gbpChanged) {
    return NextResponse.json({ ok: false, error: "no_fields" }, { status: 400 });
  }

  const sets = [];
  const values = [params.id];
  if (socialChanged) {
    values.push(JSON.stringify(social));
    sets.push(`social_text = $${values.length}`);
  }
  if (gbpChanged) {
    values.push(body.gbp_text.trim() || null);
    sets.push(`gbp_text = $${values.length}`);
  }

  await query(
    `UPDATE ghostwriter_posts SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
    values
  );

  const fresh = await getDraftPost(params.id);
  return NextResponse.json({
    ok: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
