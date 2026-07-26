import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { publishReviewedPost } from "@/lib/review/publish";
import { getDraftPost, postPayload, splitSections, isDraftId } from "../../_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/drafts/[id]/publish
 * Freigabe: draft_review → published (zentraler Review-Publish-Flow).
 */
export async function POST(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  if (!isDraftId(params.id)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Client-Flow-Tenants (z.B. Baurimmo) geben in ihrer eigenen App frei —
  // sonst entstehen zwei konkurrierende Freigaben fuer denselben Draft.
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

  let result;
  try {
    result = await publishReviewedPost(params.id, { source: "admin" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "publish_failed", detail: e.message }, { status: 400 });
  }

  const fresh = await getDraftPost(params.id);
  return NextResponse.json({
    ok: true,
    blogUrl: result.blogUrl || null,
    alreadyPublished: result.alreadyPublished === true,
    publishError: result.publishError || null,
    visualQa: result.qaVisual || null,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
  });
}
