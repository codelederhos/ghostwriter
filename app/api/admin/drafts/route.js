import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { normalizeQa } from "./_lib/workspace";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/drafts
 * Liste aller Review-Drafts (status=draft_review) ueber ALLE Tenants.
 * Query-Params:
 * - includeRejected=1 → zusaetzlich status=rejected
 * - tenantId=<uuid>   → nur ein Tenant
 */
export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const includeRejected = searchParams.get("includeRejected") === "1";
  const tenantId = searchParams.get("tenantId");

  const statuses = includeRejected ? ["draft_review", "rejected"] : ["draft_review"];

  const params = [statuses];
  // Nur Core-Review-Tenants: Client-Flow-Tenants (z.B. Baurimmo) reviewen in
  // ihrer eigenen App, sonst gaebe es zwei konkurrierende Freigabe-Oberflaechen.
  let where = "gp.status = ANY($1) AND COALESCE(ts.review_flow, 'core') = 'core'";
  if (tenantId) {
    params.push(tenantId);
    where += ` AND gp.tenant_id = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT gp.id, gp.tenant_id, gp.language, gp.category, gp.angle, gp.status,
            gp.is_test, gp.blog_title, gp.blog_slug, gp.image_url,
            gp.qa_score, gp.qa_issues, gp.review_notified_at, gp.reviewed_at,
            gp.created_at, gp.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug
     FROM ghostwriter_posts gp
     JOIN tenants t ON t.id = gp.tenant_id
     LEFT JOIN tenant_settings ts ON ts.tenant_id = gp.tenant_id
     WHERE ${where}
     ORDER BY gp.created_at DESC
     LIMIT 200`,
    params
  );

  const drafts = rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    tenant_slug: row.tenant_slug,
    language: row.language,
    category: row.category,
    angle: row.angle,
    status: row.status,
    is_test: row.is_test === true,
    blog_title: row.blog_title,
    blog_slug: row.blog_slug,
    image_url: row.image_url,
    qa_score: row.qa_score,
    qa: normalizeQa(row.qa_issues, row.qa_score),
    review_notified_at: row.review_notified_at,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return NextResponse.json({ ok: true, drafts });
}
