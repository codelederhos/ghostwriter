import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rejectReviewedPost } from "@/lib/review/publish";
import { getDraftPost, postPayload, splitSections, isDraftId } from "../../_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/drafts/[id]/reject
 * Body: { reason?: string }
 * Verwerfen: draft_review → rejected (bleibt zur Doku erhalten).
 */
export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  if (!isDraftId(params.id)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Client-Flow-Tenants reviewen in ihrer eigenen App (siehe publish-Route)
  const { rows: [flowRow] } = await query(
    `SELECT COALESCE(ts.review_flow, 'core') AS review_flow
     FROM ghostwriter_posts gp
     LEFT JOIN tenant_settings ts ON ts.tenant_id = gp.tenant_id
     WHERE gp.id = $1`,
    [params.id]
  );
  if (!flowRow) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (flowRow.review_flow === "client") {
    return NextResponse.json(
      { ok: false, error: "review_in_client_app", detail: "Dieser Tenant reviewt in seiner eigenen App (z.B. Baurimmo-Admin/Telegram), nicht im Ghostwriter-Workspace." },
      { status: 403 }
    );
  }

  let reason = null;
  try {
    const body = await req.json();
    if (typeof body?.reason === "string" && body.reason.trim()) reason = body.reason.trim().slice(0, 500);
  } catch {
    // Body optional
  }

  try {
    await rejectReviewedPost(params.id, { reason });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "reject_failed", detail: e.message }, { status: 400 });
  }

  const fresh = await getDraftPost(params.id);
  return NextResponse.json({
    ok: true,
    rejected: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
