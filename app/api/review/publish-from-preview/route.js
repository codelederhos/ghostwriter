/**
 * POST /api/review/publish-from-preview — Freigabe direkt aus der Draft-Preview.
 * Body: { token }
 *
 * BEWUSSTE ENTSCHEIDUNG: Hier reicht der PREVIEW-Token zum Veröffentlichen
 * (nicht nur der separate Publish-Token). Der Preview-Link wird ausschließlich
 * über Stanis Telegram verteilt — wer den Link hat, ist der Reviewer und darf
 * freigeben. Damit funktioniert der "Freigeben"-Button in der Vorschau ohne
 * zweiten Link. Fail-closed bleibt: nur draft_review-Posts, Hash-Vergleich,
 * Rate-Limit, keine Existenz-Infos bei ungültigem Token.
 */

import { NextResponse } from "next/server";
import { findPostByReviewToken, publishReviewedPost } from "@/lib/review/publish";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Einfaches In-Memory-Rate-Limit pro IP (Muster wie /api/review/publish)
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX_ATTEMPTS = 30;
const rlAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const list = (rlAttempts.get(ip) || []).filter((ts) => now - ts < RL_WINDOW_MS);
  list.push(now);
  rlAttempts.set(ip, list);
  if (rlAttempts.size > 500) {
    for (const [key, timestamps] of rlAttempts) {
      if (!timestamps.some((ts) => now - ts < RL_WINDOW_MS)) rlAttempts.delete(key);
    }
  }
  return list.length > RL_MAX_ATTEMPTS;
}

export async function POST(req) {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Zu viele Anfragen. Bitte später erneut versuchen." },
      { status: 429, headers: { "Retry-After": "600" } }
    );
  }

  let token = null;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    token = null;
  }
  if (!token || typeof token !== "string" || token.length < 16 || token.length > 256) {
    return NextResponse.json({ ok: false, error: "Link ungültig." }, { status: 404 });
  }

  try {
    const post = await findPostByReviewToken("preview", token);
    if (!post) {
      return NextResponse.json({ ok: false, error: "Link ungültig." }, { status: 404 });
    }

    // Idempotent: bereits veröffentlicht → ok
    if (post.status === "published") {
      return NextResponse.json({
        ok: true,
        alreadyPublished: true,
        blogUrl: post.blog_url || null,
      });
    }

    // Nur Review-Drafts sind freigabefähig (rejected/failed etc. → 410)
    if (post.status !== "draft_review") {
      return NextResponse.json(
        { ok: false, error: "Dieser Artikel kann nicht mehr freigegeben werden." },
        { status: 410 }
      );
    }

    const result = await publishReviewedPost(post.id, { source: "preview" });
    return NextResponse.json({
      ok: true,
      alreadyPublished: result.alreadyPublished === true,
      blogUrl: result.blogUrl || null,
      publishError: result.publishError || null,
      visualQa: result.qaVisual || null,
    });
  } catch (err) {
    // Kein Token, keine Post-Details im Log oder in der Antwort
    console.error("[api/review/publish-from-preview] Fehler:", err.message);
    if (err.code === "visual_qa_failed") {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          visualQa: err.qaVisual || null,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Veröffentlichung fehlgeschlagen. Bitte später erneut versuchen." },
      { status: 500 }
    );
  }
}
