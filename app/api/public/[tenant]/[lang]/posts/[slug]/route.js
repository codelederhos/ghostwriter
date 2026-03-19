/**
 * Public API: Einzelner Post als JSON
 * GET /api/public/[tenant]/[lang]/posts/[slug]
 * Kein Auth — nur published Posts.
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
  const { tenant, lang, slug } = params;

  const { rows: [t] } = await query(
    "SELECT id, name, slug FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });

  const { rows: [post] } = await query(
    `SELECT id, blog_title, blog_slug, blog_body, blog_title_tag, blog_meta_description,
            blog_primary_keyword, category, angle, language,
            image_url, image_alt_text, image_url_2, image_alt_text_2,
            gbp_text, published_at, updated_at, qa_score
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status = 'published'`,
    [t.id, lang, slug]
  );
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  return NextResponse.json({
    ...post,
    url: `${baseUrl}/${tenant}/${lang}/blog/${post.blog_slug}`,
  }, { headers: CORS });
}
