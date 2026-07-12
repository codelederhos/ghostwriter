/**
 * POST /api/review/section-regenerate — Sektion aus der Draft-Preview neu generieren.
 * Body: { token, idx, wish }
 *
 * Auth: Preview-Token (sha256-Hash-Vergleich via findPostByReviewToken).
 * Nur Posts im Status draft_review sind editierbar.
 * Anders als die Admin-Route (/api/admin/drafts/[id]/section/[idx]/regenerate)
 * persistiert diese Route DIREKT: blog_body wird mit der ersetzten Sektion
 * aktualisiert (der Preview-Nutzer hat keinen zweiten Bestaetigungs-Schritt).
 * Gemeinsame KI-Logik: regenerateSectionHtml in _lib/workspace.js.
 *
 * Fail-closed wie /api/review/publish: kein Treffer → 404 ohne Existenz-Infos,
 * falscher Status → 410. Tokens werden nie geloggt.
 */

import { NextResponse } from "next/server";
import { findPostByReviewToken } from "@/lib/review/publish";
import { getClientIp } from "@/lib/rate-limit";
import {
  regenerateSectionHtml,
  replaceSection,
  saveBlogBody,
} from "@/app/api/admin/drafts/_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Einfaches In-Memory-Rate-Limit pro IP (Single-Container-Deployment),
// Muster wie /api/review/publish — hier 30 Versuche / 10 Minuten,
// weil ein Redaktions-Durchlauf mehrere Regenerationen braucht.
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

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ungültige Anfrage." }, { status: 400 });
  }

  const token = body?.token;
  if (!token || typeof token !== "string" || token.length < 16 || token.length > 256) {
    return NextResponse.json({ ok: false, error: "Link ungültig." }, { status: 404 });
  }

  const idx = Number.parseInt(body?.idx, 10);
  if (Number.isNaN(idx) || idx < 0) {
    return NextResponse.json({ ok: false, error: "Ungültige Sektion." }, { status: 400 });
  }

  const wish = String(body?.wish || "").trim();
  if (!wish) {
    return NextResponse.json({ ok: false, error: "Bitte eine Anweisung eingeben." }, { status: 400 });
  }
  if (wish.length > 2000) {
    return NextResponse.json({ ok: false, error: "Anweisung ist zu lang (max. 2000 Zeichen)." }, { status: 400 });
  }

  try {
    const post = await findPostByReviewToken("preview", token);
    if (!post) {
      return NextResponse.json({ ok: false, error: "Link ungültig." }, { status: 404 });
    }
    if (post.status !== "draft_review") {
      return NextResponse.json(
        { ok: false, error: "Dieser Artikel kann nicht mehr bearbeitet werden." },
        { status: 410 }
      );
    }

    const { newHtml } = await regenerateSectionHtml(post, idx, wish);

    // Direkt persistieren: Sektion im Gesamt-Body ersetzen und speichern
    const newBody = replaceSection(post.blog_body || "", idx, newHtml);
    await saveBlogBody(post.id, newBody);

    return NextResponse.json({ ok: true, new_html: newHtml });
  } catch (e) {
    if (e.code === "section_out_of_range") {
      return NextResponse.json({ ok: false, error: "Diese Sektion existiert nicht mehr. Bitte Seite neu laden." }, { status: 400 });
    }
    if (e.code === "llm_failed" || e.code === "empty_result") {
      return NextResponse.json(
        { ok: false, error: "KI-Generierung fehlgeschlagen. Bitte erneut versuchen." },
        { status: 502 }
      );
    }
    // Kein Token, keine Post-Details im Log oder in der Antwort
    console.error("[api/review/section-regenerate] Fehler:", e.message);
    return NextResponse.json(
      { ok: false, error: "Neu generieren fehlgeschlagen. Bitte später erneut versuchen." },
      { status: 500 }
    );
  }
}
