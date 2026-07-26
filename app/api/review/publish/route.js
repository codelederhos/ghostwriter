/**
 * POST /api/review/publish — Veröffentlichung per Publish-Token.
 * Fail-closed:
 *   - kein/ungültiger Token oder kein Treffer      → 404 (keine Existenz-Infos leaken)
 *   - Token bereits verwendet (und nicht published) → 410
 *   - Token älter als 14 Tage                       → 410
 *   - Post nicht mehr im Review-Status              → 410
 *   - status='published'                            → idempotent ok
 * Tokens werden nie geloggt, Vergleich nur über sha256-Hash (lib/review/publish.js).
 */

import { NextResponse } from "next/server";
import { findPostByReviewToken, publishReviewedPost } from "@/lib/review/publish";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Einfaches In-Memory-Rate-Limit pro IP (Single-Container-Deployment).
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX_ATTEMPTS = 20;
const rlAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const list = (rlAttempts.get(ip) || []).filter((ts) => now - ts < RL_WINDOW_MS);
  list.push(now);
  rlAttempts.set(ip, list);
  // Map gelegentlich aufräumen, damit sie nicht wächst
  if (rlAttempts.size > 500) {
    for (const [key, timestamps] of rlAttempts) {
      if (!timestamps.some((ts) => now - ts < RL_WINDOW_MS)) rlAttempts.delete(key);
    }
  }
  return list.length > RL_MAX_ATTEMPTS;
}

const TOKEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export async function POST(req) {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte später erneut versuchen." },
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
    return NextResponse.json({ error: "Link ungültig." }, { status: 404 });
  }

  try {
    const post = await findPostByReviewToken("publish", token);
    if (!post) {
      return NextResponse.json({ error: "Link ungültig." }, { status: 404 });
    }

    // Idempotent: bereits veröffentlicht → ok
    if (post.status === "published") {
      return NextResponse.json({
        ok: true,
        alreadyPublished: true,
        blogUrl: post.blog_url || null,
      });
    }

    // Token bereits verwendet (aber Post nicht live) → Link tot
    if (post.review_publish_token_used_at) {
      return NextResponse.json(
        { error: "Dieser Freigabe-Link wurde bereits verwendet." },
        { status: 410 }
      );
    }

    // Ablauf: älter als 14 Tage (fehlendes created_at = fail-closed abgelaufen)
    const createdAt = post.review_publish_token_created_at
      ? new Date(post.review_publish_token_created_at)
      : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || Date.now() - createdAt.getTime() > TOKEN_MAX_AGE_MS) {
      return NextResponse.json(
        { error: "Dieser Freigabe-Link ist abgelaufen." },
        { status: 410 }
      );
    }

    // Nur Review-Drafts sind freigabefähig (rejected/failed etc. → Link tot)
    if (post.status !== "draft_review") {
      return NextResponse.json(
        { error: "Dieser Artikel kann nicht mehr über diesen Link veröffentlicht werden." },
        { status: 410 }
      );
    }

    const result = await publishReviewedPost(post.id, { source: "review-token" });
    return NextResponse.json({
      ok: true,
      alreadyPublished: result.alreadyPublished === true,
      blogUrl: result.blogUrl || null,
      publishError: result.publishError || null,
      visualQa: result.qaVisual || null,
    });
  } catch (err) {
    // Kein Token, keine Post-Details im Log oder in der Antwort
    console.error("[api/review/publish] Fehler:", err.message);
    if (err.code === "visual_qa_failed") {
      return NextResponse.json(
        {
          error: err.message,
          visualQa: err.qaVisual || null,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: "Veröffentlichung fehlgeschlagen. Bitte später erneut versuchen." },
      { status: 500 }
    );
  }
}
