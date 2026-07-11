import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getDraftPost,
  postPayload,
  splitSections,
  joinSections,
  replaceSection,
  sanitizeArticleHtml,
  saveBlogBody,
} from "../../../_lib/workspace";

export const dynamic = "force-dynamic";

function parseIdx(value) {
  const idx = Number.parseInt(value, 10);
  return Number.isNaN(idx) || idx < 0 ? null : idx;
}

/**
 * PATCH /api/admin/drafts/[id]/section/[idx]
 * Body: { html: string }
 * Ueberschreibt die Sektion idx im blog_body (serverseitig sanitized).
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
  const newHtml = typeof body?.html === "string" ? body.html : null;
  if (newHtml === null) return NextResponse.json({ ok: false, error: "html_required" }, { status: 400 });

  const idx = parseIdx(params.idx);
  if (idx === null) return NextResponse.json({ ok: false, error: "invalid_idx" }, { status: 400 });

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const sections = splitSections(post.blog_body || "");
  if (idx >= sections.length) {
    return NextResponse.json({ ok: false, error: "section_out_of_range", max: sections.length - 1 }, { status: 400 });
  }

  const safeHtml = sanitizeArticleHtml(newHtml);
  if (!safeHtml) return NextResponse.json({ ok: false, error: "empty_html" }, { status: 400 });

  let newBody;
  try {
    newBody = replaceSection(post.blog_body || "", idx, safeHtml);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "replace_failed", detail: e.message }, { status: 500 });
  }

  const fresh = await saveBlogBody(params.id, newBody);
  return NextResponse.json({
    ok: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}

/**
 * DELETE /api/admin/drafts/[id]/section/[idx]
 * Entfernt die Sektion idx und setzt blog_body aus den uebrigen neu zusammen.
 */
export async function DELETE(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const idx = parseIdx(params.idx);
  if (idx === null) return NextResponse.json({ ok: false, error: "invalid_idx" }, { status: 400 });

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const sections = splitSections(post.blog_body || "");
  if (idx >= sections.length) {
    return NextResponse.json({ ok: false, error: "section_out_of_range", max: sections.length - 1 }, { status: 400 });
  }
  if (sections.length <= 1) {
    return NextResponse.json({ ok: false, error: "last_section", detail: "Die letzte Sektion kann nicht gelöscht werden." }, { status: 400 });
  }

  const remaining = sections.filter((_, i) => i !== idx);
  const fresh = await saveBlogBody(params.id, joinSections(remaining));

  return NextResponse.json({
    ok: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
