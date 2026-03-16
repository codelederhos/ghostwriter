import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");

  // Wörter + Bilder direkt in SQL zählen — kein HTML Transfer für Counts
  const baseCols = `
    gp.id, gp.blog_title, gp.blog_slug, gp.language, gp.category, gp.angle,
    gp.status, gp.is_test, gp.created_at, gp.published_at, gp.image_url,
    t.name as tenant_name, t.slug as tenant_slug`;

  const countCols = `
    array_length(
      string_to_array(
        trim(regexp_replace(blog_body, '<[^>]+>', ' ', 'g')),
        ' '
      ), 1
    ) as word_count,
    (length(blog_body) - length(replace(blog_body, '<img ', ''))) / 5 as image_count`;

  let sql, args;
  if (tenantId) {
    sql = `
      SELECT ${baseCols}, ${countCols}
      FROM ghostwriter_posts gp
      JOIN tenants t ON t.id = gp.tenant_id
      WHERE gp.tenant_id = $1
      ORDER BY gp.created_at DESC
      LIMIT 200
    `;
    args = [tenantId];
  } else {
    sql = `
      SELECT ${baseCols}
      FROM ghostwriter_posts gp
      JOIN tenants t ON t.id = gp.tenant_id
      ORDER BY gp.created_at DESC
      LIMIT 100
    `;
    args = [];
  }

  const { rows: posts } = await query(sql, args);
  return NextResponse.json({ posts });
}
