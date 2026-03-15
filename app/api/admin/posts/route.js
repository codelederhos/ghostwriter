import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows } = await query(`
    SELECT gp.id, gp.blog_title, gp.blog_slug, gp.language, gp.category,
           gp.status, gp.created_at, gp.published_at,
           t.name as tenant_name, t.slug as tenant_slug
    FROM ghostwriter_posts gp
    JOIN tenants t ON t.id = gp.tenant_id
    ORDER BY gp.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json({ posts: rows });
}
