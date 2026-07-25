import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { loadTenant, stripMetaSections } from "@/lib/pipeline/index.js";
import { runQA } from "@/lib/pipeline/steps/qa.js";
import { runCorrector } from "@/lib/pipeline/steps/corrector.js";
import { runSocialWriter } from "@/lib/pipeline/steps/social_writer.js";
import { syncReviewDraftToClient } from "@/lib/pipeline/steps/publisher.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function timingSafeEquals(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * POST /api/admin/posts/requalify  { postId }
 *
 * Bestehenden draft_review-Post erneut bewerten und iterativ korrigieren
 * (Stani 22.07.2026: "werden die nicht optimiert dann und neu bewertet??").
 * Gleicher Loop wie in der Pipeline: QA → Corrector → Re-QA, max 3 Runden,
 * Abbruch ohne Fixes oder ohne Verbesserung. Persistiert Body/Texte/Score
 * und zieht die Client-Draft-Kopie (review_flow='client') nach.
 */
export async function POST(req) {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const expected = process.env.GHOSTWRITER_ADMIN_TOKEN || "";
  let isAuthed = false;
  if (bearer && expected && timingSafeEquals(bearer, expected)) {
    isAuthed = true;
  } else {
    const session = await requireAdmin();
    if (session) isAuthed = true;
  }
  if (!isAuthed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = String(body.postId || "").trim();
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const { rows: [post] } = await query("SELECT * FROM ghostwriter_posts WHERE id = $1", [postId]);
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });
  if (post.status !== "draft_review") {
    return NextResponse.json({ error: `Nur draft_review (ist: ${post.status})` }, { status: 409 });
  }

  const loaded = await loadTenant(post.tenant_id);
  const { tenant, settings, profile } = loaded;
  const sysConfig = loaded.sysConfig || {};

  const article = {
    title: post.blog_title,
    title_tag: post.blog_title_tag,
    meta_description: post.blog_meta_description,
    body_html: post.blog_body,
    slug: post.blog_slug,
    gbp_text: post.gbp_text,
  };
  const seo = { primaryKeyword: post.blog_primary_keyword || post.blog_title };
  const plan = { categoryLabel: post.category || "", angleName: post.angle || "" };

  // Alt-Drafts ohne Social/GBP-Paket: nachgenerieren — das "Social und GBP
  // vorbereitet"-Gate drückte sonst jeden alten Draft dauerhaft (22.07.2026).
  let socialUpdated = null;
  const hasSocial = post.social_text && String(post.social_text).length > 20;
  if (!hasSocial || !post.gbp_text) {
    try {
      const social = await runSocialWriter(settings, article, seo, profile, post.language || "de");
      if (social?.gbp && !post.gbp_text) article.gbp_text = social.gbp;
      socialUpdated = social;
      article._social = social;
    } catch (err) {
      console.error("[requalify] Social-Nachgenerierung:", err?.message || err);
    }
  } else {
    try { article._social = typeof post.social_text === "object" ? post.social_text : JSON.parse(post.social_text); } catch { /* ok */ }
  }

  const qaOpts = { reviewMode: true, tenant, profile, plan, override: null };
  let qaResult = await runQA(article, seo, settings, sysConfig, qaOpts);
  const startScore = qaResult.score;
  let rounds = 0;
  const roundLog = [];

  while (qaResult.score !== null && qaResult.score < 8 && qaResult.issues.length > 0 && rounds < 3) {
    const prevScore = qaResult.score;
    let fixes;
    try {
      fixes = await runCorrector(article, seo, profile, qaResult.issues, settings);
    } catch (err) {
      roundLog.push(`Runde ${rounds + 1}: Corrector-Fehler ${err.message.slice(0, 80)}`);
      break;
    }
    const fixCount = Object.keys(fixes).length;
    if (fixCount === 0) {
      roundLog.push(`Runde ${rounds + 1}: keine anwendbaren Fixes`);
      break;
    }
    Object.assign(article, fixes);
    article.body_html = stripMetaSections(article.body_html);
    qaResult = await runQA(article, seo, settings, sysConfig, qaOpts);
    rounds++;
    roundLog.push(`Runde ${rounds}: ${fixCount} Fix(es), ${prevScore} → ${qaResult.score}`);
    if (qaResult.score !== null && qaResult.score <= prevScore) break;
  }

  await query(
    `UPDATE ghostwriter_posts SET
       blog_title = $2, blog_title_tag = $3, blog_meta_description = $4,
       blog_body = $5, gbp_text = $6, qa_score = $7, qa_issues = $8::jsonb,
       social_text = COALESCE($9::jsonb, social_text),
       updated_at = now()
     WHERE id = $1`,
    [
      postId,
      article.title, article.title_tag, article.meta_description,
      article.body_html, article.gbp_text,
      qaResult.score,
      JSON.stringify({ issues: qaResult.issues, checks: qaResult.checks || [], requalified_at: new Date().toISOString(), rounds }),
      socialUpdated ? JSON.stringify(socialUpdated) : null,
    ]
  );
  syncReviewDraftToClient(postId).catch((err) =>
    console.error("[requalify] Client-Draft-Sync:", err?.message || err)
  );

  return NextResponse.json({
    ok: true,
    postId,
    scoreBefore: post.qa_score,
    scoreFreshQa: startScore,
    scoreAfter: qaResult.score,
    rounds,
    log: roundLog,
    openIssues: qaResult.issues.length,
  });
}
