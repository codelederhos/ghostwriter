import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/lib/pipeline/index.js";

// In-Flight-Dedup: Doppelklick im Scout-UI / Caller-Retry startete zwei
// parallele Pipelines für denselben Kandidaten (Audit 17.07.2026).
const inFlight = new Map(); // key -> startedAt
const IN_FLIGHT_TTL_MS = 2 * 60 * 60 * 1000;

function timingSafeEquals(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickTitle(brief, fallbackTitle) {
  return firstText(
    fallbackTitle,
    brief?.mainTitle,
    brief?.title,
    brief?.titles?.main,
    brief?.haupttitel,
    brief?.headline
  );
}

function briefLines(value, prefix = "") {
  if (value == null || value === "") return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${prefix}${String(value)}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => briefLines(item, `${prefix}${index + 1}. `));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      const label = key.replace(/[_-]+/g, " ");
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        return [`${prefix}${label}: ${String(item)}`];
      }
      const nested = briefLines(item, "");
      return nested.length ? [`${prefix}${label}:`, ...nested.map((line) => `  ${line}`)] : [];
    });
  }
  return [];
}

function serializeBriefing({ brief, briefingText, qaHints, opportunityId, briefId }) {
  const parts = [];
  parts.push("INTERNES BRIEFING — reine Steuerungsinformation. NIEMALS als Artikelinhalt, Sektion, Checkliste oder Kasten übernehmen; interne Projekt-/Markennamen daraus nie erwähnen.");
  if (brief && typeof brief === "object") {
    parts.push("AUSARBEITUNGSNOTIZ");
    parts.push(...briefLines(brief));
  }
  if (briefingText) {
    parts.push("ZUSATZ-BRIEFING");
    parts.push(String(briefingText).trim());
  }
  if (qaHints) {
    parts.push("QA-HINWEISE UND GUARDRAILS");
    parts.push(...briefLines(qaHints));
  }
  if (opportunityId || briefId) {
    parts.push("REFERENZEN");
    if (opportunityId) parts.push(`opportunity_id: ${opportunityId}`);
    if (briefId) parts.push(`brief_id: ${briefId}`);
  }
  return parts.filter(Boolean).join("\n").trim() || null;
}

/**
 * POST /api/admin/posts/quick-generate
 *
 * Body: { tenantId, title?, primaryKeyword?, briefingText?, brief?, languages?, reviewMode?, draftOnly? }
 * Auth: Cookie-Session (Admin) ODER Bearer-Token (GHOSTWRITER_ADMIN_TOKEN)
 *
 * Standard fuer Briefings: Review-Draft erzeugen. Kein Live-Publish ohne separaten Publish-Schritt.
 */
export async function POST(req) {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const expectedToken = process.env.GHOSTWRITER_ADMIN_TOKEN || "";
  let isAuthed = false;

  if (bearer && expectedToken && timingSafeEquals(bearer, expectedToken)) {
    isAuthed = true;
  } else {
    const session = await requireAdmin();
    if (session) isAuthed = true;
  }

  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    tenantId,
    title,
    primaryKeyword,
    briefingText,
    brief,
    languages,
    reviewMode = true,
    draftOnly = true,
    opportunityId,
    briefId,
    recommendation,
    qaHints,
  } = body || {};

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const forcedTitle = pickTitle(brief, title);
  if (!forcedTitle) {
    return NextResponse.json({ error: "title or brief.mainTitle required" }, { status: 400 });
  }

  const forcedKeyword = firstText(
    primaryKeyword,
    brief?.primaryKeyword,
    brief?.keyword,
    brief?.whyNow?.gsc?.query,
    brief?.query
  ) || null;

  const briefing = serializeBriefing({ brief, briefingText, qaHints, opportunityId, briefId });
  const forcedLanguages = Array.isArray(languages) && languages.length > 0 ? languages : ["de"];
  const isReviewMode = reviewMode !== false || draftOnly !== false;

  const override = {
    forcedTitle,
    forcedKeyword,
    briefing,
    briefingStructured: brief && typeof brief === "object" ? brief : null,
    forcedLanguages,
    reviewMode: isReviewMode,
    draftOnly: isReviewMode,
    opportunityId: opportunityId || brief?.opportunityId || brief?.opportunity_id || null,
    briefId: briefId || brief?.id || brief?.briefId || brief?.brief_id || null,
    recommendation: recommendation || brief?.recommendation || null,
    qaHints: qaHints || brief?.publishRisk || brief?.publish_risk || null,
  };

  // Dedup pro Kandidat: briefId/opportunityId, sonst Titel
  const dedupKey = `${tenantId}:${override.briefId || override.opportunityId || forcedTitle.toLowerCase()}`;
  const now = Date.now();
  for (const [k, t] of inFlight) { if (now - t > IN_FLIGHT_TTL_MS) inFlight.delete(k); }
  if (inFlight.has(dedupKey)) {
    return NextResponse.json({
      ok: true,
      status: "already_running",
      message: "Für diesen Kandidaten läuft bereits eine Generierung.",
      title: override.forcedTitle,
    }, { status: 409 });
  }
  inFlight.set(dedupKey, now);

  runPipeline(tenantId, {
    preview: false,
    reviewMode: isReviewMode,
    draftOnly: isReviewMode,
    override,
    isTest: false,
  }).catch((err) =>
    console.error("[quick-generate] Pipeline error:", err?.message || err)
  ).finally(() => inFlight.delete(dedupKey));

  return NextResponse.json({
    ok: true,
    status: "started",
    mode: isReviewMode ? "review_draft" : "publish",
    message: isReviewMode
      ? "Draft wird erzeugt und in Review bereitgestellt. Keine Live-Veröffentlichung."
      : "Generierung läuft mit Publish-Freigabe.",
    title: override.forcedTitle,
    languages: override.forcedLanguages,
    opportunityId: override.opportunityId,
    briefId: override.briefId,
  });
}
