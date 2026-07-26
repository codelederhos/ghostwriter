import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getDraftPost, regenerateSectionHtml } from "../../../../_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/drafts/[id]/section/[idx]/regenerate
 * Body: { wish: string }
 * Schreibt die Sektion per KI neu (gemeinsame Logik: regenerateSectionHtml in
 * _lib/workspace.js, wird auch von /api/review/section-regenerate genutzt).
 * Persistiert NICHT — liefert nur new_html/old_html, der Client bestaetigt
 * und speichert dann via PATCH section.
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
  const wish = String(body?.wish || "").trim();
  if (!wish) return NextResponse.json({ ok: false, error: "wish_required" }, { status: 400 });

  const idx = Number.parseInt(params.idx, 10);
  if (Number.isNaN(idx) || idx < 0) {
    return NextResponse.json({ ok: false, error: "invalid_idx" }, { status: 400 });
  }

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  try {
    const { newHtml, oldHtml } = await regenerateSectionHtml(post, idx, wish);
    return NextResponse.json({ ok: true, new_html: newHtml, old_html: oldHtml });
  } catch (e) {
    if (e.code === "section_out_of_range") {
      return NextResponse.json({ ok: false, error: "section_out_of_range", max: e.max }, { status: 400 });
    }
    if (e.code === "tenant_load_failed") {
      return NextResponse.json({ ok: false, error: "tenant_load_failed", detail: e.message }, { status: 500 });
    }
    if (e.code === "llm_failed") {
      return NextResponse.json({ ok: false, error: "llm_failed", detail: e.message }, { status: 502 });
    }
    if (e.code === "empty_result") {
      return NextResponse.json({ ok: false, error: "empty_result" }, { status: 502 });
    }
    console.error("[admin/section/regenerate] Fehler:", e.message);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
