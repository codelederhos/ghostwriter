import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = ["blog_title_tag", "blog_meta_description", "gbp_text"];

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = params;
  const { rows } = await query(
    `SELECT id, blog_title, blog_slug, blog_body, gbp_text,
            blog_title_tag, blog_meta_description, blog_primary_keyword,
            qa_score, qa_issues,
            language, category, angle, status, is_test,
            image_url, image_url_2, created_at, published_at
     FROM ghostwriter_posts WHERE id = $1`,
    [postId]
  );

  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post: rows[0] });
}

export async function PATCH(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = params;
  const { field, value } = await req.json();

  if (!EDITABLE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Field not allowed" }, { status: 400 });
  }

  await query(`UPDATE ghostwriter_posts SET ${field} = $1 WHERE id = $2`, [value, postId]);
  return NextResponse.json({ ok: true });
}
