import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { loadTenant } from "@/lib/pipeline/index.js";
import { runQaVisual } from "@/lib/pipeline/steps/qa_visual.js";
import { validateTrustedQaUrl } from "@/lib/security/trusted-qa-url.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const RECENT_QA_MS = 5 * 60 * 1000;
const MIN_RUN_INTERVAL_MS = 60 * 1000;
const activeRuns = new Map();
const lastRunStarts = new Map();

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
  const force = body.force === true;
  let previous = post.qa_visual;
  if (typeof previous === "string") {
    try { previous = JSON.parse(previous); } catch { previous = null; }
  }
  const checkedAt = previous?.checked_at ? new Date(previous.checked_at).getTime() : 0;
  if (!force && checkedAt && Date.now() - checkedAt < RECENT_QA_MS) {
    return NextResponse.json({ ok: previous.ok === true, executed: false, cached: true, findings: previous });
  }

  const { tenant, settings } = await loadTenant(post.tenant_id);
  let blogUrl;
  try {
    blogUrl = await validateTrustedQaUrl({
      candidate: post.blog_url || body.blogUrl,
      tenantDomain: tenant.domain,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
      tenantSlug: tenant.slug,
      language: post.language,
      blogSlug: post.blog_slug,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const runKey = String(post.id);
  if (activeRuns.has(runKey)) {
    return NextResponse.json({ ok: false, executed: false, inProgress: true }, { status: 409 });
  }
  const lastStart = lastRunStarts.get(runKey) || 0;
  if (Date.now() - lastStart < MIN_RUN_INTERVAL_MS) {
    return NextResponse.json(
      { ok: false, executed: false, error: "Visual-QA wurde gerade erst gestartet" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const run = runQaVisual({ tenant, settings, post, blogUrl });
  lastRunStarts.set(runKey, Date.now());
  if (lastRunStarts.size > 500) {
    const cutoff = Date.now() - RECENT_QA_MS;
    for (const [key, startedAt] of lastRunStarts) {
      if (startedAt < cutoff) lastRunStarts.delete(key);
    }
  }
  activeRuns.set(runKey, run);
  try {
    const result = await run;
    return NextResponse.json(result, { status: result.executed ? 200 : 502 });
  } finally {
    activeRuns.delete(runKey);
  }
}
