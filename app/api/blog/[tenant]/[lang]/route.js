import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Public Blog API
 * GET /api/blog/{tenant-slug}/{lang}?page=1&limit=10
 */
export async function GET(req, { params }) {
  const { tenant, lang } = params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 50);
  const offset = (page - 1) * limit;

  // Resolve tenant
  const { rows: [t] } = await query(
    "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { rows: posts } = await query(
    `SELECT id, blog_title, blog_slug, blog_meta_description, blog_primary_keyword,
            image_url, image_alt_text, published_at, category, angle
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND status = 'published'
     ORDER BY published_at DESC
     LIMIT $3 OFFSET $4`,
    [t.id, lang, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    "SELECT COUNT(*)::int FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND status = 'published'",
    [t.id, lang]
  );

  return NextResponse.json({
    posts,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  });
}
