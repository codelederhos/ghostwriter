import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { loadTenant } from "@/lib/pipeline/index.js";
import { runQaVisual } from "@/lib/pipeline/steps/qa_visual.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function isAuthorized(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const expected = process.env.GHOSTWRITER_ADMIN_TOKEN || "";
  if (bearer && expected && timingSafeEquals(bearer, expected)) return true;
  return Boolean(await requireAdmin());
}

export async function POST(request, { params }) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await params;
  const { rows: [post] } = await query(
    "SELECT * FROM ghostwriter_posts WHERE id = $1",
    [String(postId || "").trim()]
  );
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const blogUrl = String(body.blogUrl || post.blog_url || "").trim();
  if (!/^https?:\/\//i.test(blogUrl)) {
    return NextResponse.json({ error: "Gültige blogUrl erforderlich" }, { status: 400 });
  }

  const { tenant, settings } = await loadTenant(post.tenant_id);
  const result = await runQaVisual({ tenant, settings, post, blogUrl });
  return NextResponse.json(result, { status: result.executed ? 200 : 502 });
}
