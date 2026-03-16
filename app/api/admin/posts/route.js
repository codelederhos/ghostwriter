import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");

  let sql, args;
  if (tenantId) {
    sql = `
      SELECT gp.id, gp.blog_title, gp.blog_slug, gp.language, gp.category, gp.angle,
             gp.status, gp.is_test, gp.created_at, gp.published_at,
             gp.blog_content, gp.image_url,
             length(gp.blog_content) as content_length,
             t.name as tenant_name, t.slug as tenant_slug
      FROM ghostwriter_posts gp
      JOIN tenants t ON t.id = gp.tenant_id
      WHERE gp.tenant_id = $1
      ORDER BY gp.created_at DESC
      LIMIT 200
    `;
    args = [tenantId];
  } else {
    sql = `
      SELECT gp.id, gp.blog_title, gp.blog_slug, gp.language, gp.category,
             gp.status, gp.is_test, gp.created_at, gp.published_at,
             gp.image_url,
             t.name as tenant_name, t.slug as tenant_slug
      FROM ghostwriter_posts gp
      JOIN tenants t ON t.id = gp.tenant_id
      ORDER BY gp.created_at DESC
      LIMIT 100
    `;
    args = [];
  }

  const { rows } = await query(sql, args);

  // Wörter zählen + Bilder zählen aus HTML
  const posts = rows.map(p => {
    const wordCount = p.blog_content
      ? p.blog_content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length
      : null;
    const imageCount = p.blog_content
      ? (p.blog_content.match(/<img /g) || []).length
      : null;
    return { ...p, blog_content: undefined, word_count: wordCount, image_count: imageCount };
  });

  return NextResponse.json({ posts });
}
