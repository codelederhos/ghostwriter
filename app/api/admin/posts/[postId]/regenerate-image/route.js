import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { runImageGen } from "@/lib/pipeline/steps/image";

export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = params;

  const { rows: [post] } = await query(
    `SELECT tenant_id, blog_title, blog_slug, blog_primary_keyword,
            image_prompt_1, image_prompt_2, language, category, angle
     FROM ghostwriter_posts WHERE id = $1`,
    [postId]
  );
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const { rows: [settings] } = await query(
    "SELECT * FROM tenant_settings WHERE tenant_id = $1",
    [post.tenant_id]
  );
  if (!settings) return NextResponse.json({ error: "No settings" }, { status: 500 });

  const decrypted = { ...settings };
  for (const f of ["image_api_key", "text_api_key"]) {
    if (decrypted[f]) try { decrypted[f] = decrypt(decrypted[f]); } catch { /* ok */ }
  }
  if (decrypted.billing_mode === "platform") {
    decrypted.text_api_key = process.env.ANTHROPIC_API_KEY;
    decrypted.text_provider = "anthropic";
    if (process.env.OPENAI_API_KEY) {
      decrypted.image_api_key = process.env.OPENAI_API_KEY;
      decrypted.image_provider = "dalle3";
    }
  }

  const article = {
    title: post.blog_title,
    slug: post.blog_slug,
    image_prompt_1: post.image_prompt_1,
    image_prompt_2: post.image_prompt_2,
  };
  const seo = { primaryKeyword: post.blog_primary_keyword || "" };
  const plan = { category: post.category, angle: post.angle };

  const imageResult = await runImageGen(decrypted, article, seo, plan, post.tenant_id);

  await query(
    `UPDATE ghostwriter_posts SET image_url = $1, image_url_2 = $2 WHERE id = $3`,
    [imageResult.url, imageResult.url2 || null, postId]
  );

  return NextResponse.json({ ok: true, image_url: imageResult.url, image_url_2: imageResult.url2 });
}
