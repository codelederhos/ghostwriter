import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getDraftPost, postPayload, splitSections, slugify } from "../../_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/drafts/[id]/meta
 * Body: { title?, title_tag?, meta_description?, slug? }
 * Aktualisiert Meta-Spalten des Posts. Liefert post + sections zurueck.
 */
export async function PATCH(req, { params }) {
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

  const sets = [];
  const values = [params.id];
  const add = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ ok: false, error: "title_empty" }, { status: 400 });
    add("blog_title", title);
  }
  if (typeof body.title_tag === "string") add("blog_title_tag", body.title_tag.trim() || null);
  if (typeof body.meta_description === "string") add("blog_meta_description", body.meta_description.trim() || null);
  if (typeof body.slug === "string") {
    const slug = slugify(body.slug);
    if (!slug) return NextResponse.json({ ok: false, error: "slug_invalid" }, { status: 400 });
    add("blog_slug", slug);
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "no_fields" }, { status: 400 });
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
