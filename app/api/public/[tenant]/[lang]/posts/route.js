/**
 * Public API: Liste aller published Posts eines Tenants
 * GET /api/public/[tenant]/[lang]/posts?limit=10&page=1
 * Kein Auth erforderlich — nur published Posts.
 * CORS: open (für JS-Embed auf Client-Websites)
 */
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req, { params }) {
  const { tenant, lang } = params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 50);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const offset = (page - 1) * limit;

  const { rows: [t] } = await query(
    "SELECT id, name, slug FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404, headers: CORS });

  const { rows: posts } = await query(
    `SELECT id, blog_title, blog_slug, blog_meta_description, blog_primary_keyword,
            category, language, image_url, image_alt_text, published_at, updated_at, qa_score
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND status = 'published'
     ORDER BY published_at DESC
     LIMIT $3 OFFSET $4`,
    [t.id, lang, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    "SELECT COUNT(*) FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND status = 'published'",
    [t.id, lang]
  );

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  return NextResponse.json({
    tenant: t.slug,
    language: lang,
    total: parseInt(count),
    page,
    limit,
    posts: posts.map(p => ({
      ...p,
      url: `${baseUrl}/${tenant}/${lang}/blog/${p.blog_slug}`,
    })),
  }, { headers: CORS });
}
