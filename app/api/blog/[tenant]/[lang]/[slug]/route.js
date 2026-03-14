import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Public Blog Single Post API
 * GET /api/blog/{tenant-slug}/{lang}/{slug}
 */
export async function GET(req, { params }) {
  const { tenant, lang, slug } = params;

  const { rows: [t] } = await query(
    "SELECT id, name, slug, domain FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { rows: [post] } = await query(
    `SELECT * FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status = 'published'`,
    [t.id, lang, slug]
  );
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  // Get other language versions for hreflang
  const { rows: alternates } = await query(
    `SELECT language, blog_slug FROM ghostwriter_posts
     WHERE tenant_id = $1 AND category = $2 AND angle = $3 AND season = $4
       AND status = 'published' AND id != $5`,
    [t.id, post.category, post.angle, post.season, post.id]
  );

  // Tenant profile for structured data
  const { rows: [profile] } = await query(
    "SELECT * FROM tenant_profiles WHERE tenant_id = $1",
    [t.id]
  );

  return NextResponse.json({ post, alternates, tenant: t, profile });
}
