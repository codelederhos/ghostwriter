import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getDraftPost, postPayload, splitSections } from "../_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/drafts/[id]
 * Laedt den Draft, splittet blog_body an <h2>-Grenzen in editierbare
 * Sektionen und liefert { post, sections, qa }.
 */
export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const payload = postPayload(post);
  return NextResponse.json({
    ok: true,
    post: payload,
    sections: splitSections(post.blog_body || ""),
    qa: payload.qa,
  });
}
