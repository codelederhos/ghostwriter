import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = params;
  const { rows } = await query(
    `SELECT id, blog_title, blog_slug, blog_body, gbp_text,
            language, category, angle, status, is_test,
            image_url, image_url_2, created_at, published_at
     FROM ghostwriter_posts WHERE id = $1`,
    [postId]
  );

  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post: rows[0] });
}
