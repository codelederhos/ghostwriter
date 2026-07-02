/**
 * Step 5b: QUALITY-CHECK
 * Regelbasierte Qualitätsprüfung des fertigen Artikels.
 * Läuft nach Chart/Image/Backlink-Injektion, VOR dem DB-Insert.
 * Optional: LLM-Qualitätsbewertung (Feature-Flag qa_llm_enabled).
 *
 * Score 0–10 (10 = perfekt). Gespeichert in ghostwriter_posts.qa_score.
 * qa_issues speichert zusätzlich strukturierte Draft-Gate-Checks.
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

const CONTENT_BLOCKS = [
  "callout", "stat-grid", "compare-block", "process-steps",
  "check-list", "cross-list", "highlight-quote", "comparison-table",
  "source-pill", "data-widget",
];

const BAURIMMO_RESERVED_SLUGS = new Set([
  "kaufnebenkosten-rechner",
  "notarkosten-rechner",
  "renditerechner",
  "mietspiegel",
  "immobilienmarkt",
  "offmarket",
  "suchprofil",
  "bewerben",
  "sofort-ankauf-check",
]);

const TOOL_TOPIC_HINTS = [
  "kaufnebenkosten", "notarkosten", "grundbuch", "grunderwerbsteuer",
  "rendite", "mietspiegel", "immobilienmarkt", "offmarket", "suchprofil",
  "sofort-ankauf",
];

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMaybe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function makeCheck(id, label, passed, severity, message, evidence = null) {
  return {
    id,
    label,
    passed: Boolean(passed),
    severity,
    message,
    evidence,
  };
}

function checkWeight(check) {
  if (check.passed) return 0;
  if (check.severity === "critical") return 3;
  if (check.severity === "warning") return 1;
  return 0.5;
}

function countMatches(value, regex) {
  return [...String(value || "").matchAll(regex)].length;
}

function buildGateChecks(article, seo, settings, context = {}) {
  const body = article.body_html || "";
  const bodyText = stripHtml(body);
  const keyword = seo.primaryKeyword || article.primary_keyword || "";
  const titleText = `${article.title || ""} ${article.title_tag || ""} ${article.meta_description || ""}`;
  const briefingText = [
    context.plan?.briefing,
    context.override?.briefing,
    JSON.stringify(context.override?.briefingStructured || {}),
  ].filter(Boolean).join(" ");
  const qaHintsText = JSON.stringify(context.override?.qaHints || {});
  const tenantSlug = context.tenant?.slug || "";
  const articleSlug = normalizeSlug(article.slug || article.title);
  const briefingLower = `${briefingText} ${qaHintsText}`.toLowerCase();
  const action = context.override?.recommendation || context.override?.briefingStructured?.recommendation || null;
  const expectedIntent = context.override?.briefingStructured?.targetIntent
    || context.override?.briefingStructured?.zielIntent
    || context.override?.briefingStructured?.intent
    || context.plan?.angleName
    || keyword;

  const ctaCount = countMatches(body, /class=["'][^"']*(cta-block|cta-inline|callout--cta)[^"']*["']/gi);
  const internalLinkCount = countMatches(body, /class=["'][^"']*internal-link[^"']*["']/gi)
    + countMatches(body, /class=["'][^"']*internal-link-box[^"']*["']/gi);
  const allLinkCount = countMatches(body, /<a\s+[^>]*href=["'][^"']+["']/gi);
  const social = parseMaybe(article._social, article._social || null);
  const hasSocial = Boolean(social?.linkedin && social?.facebook);
  const hasGbp = Boolean(article.gbp_text && article.gbp_text.length >= 120);
  const reservedSlugHit = tenantSlug === "baur-immobilien" && BAURIMMO_RESERVED_SLUGS.has(articleSlug);
  const protectedTopicMentioned = tenantSlug === "baur-immobilien"
    && TOOL_TOPIC_HINTS.some((hint) => briefingLower.includes(hint) || articleSlug.includes(hint));
  const riskVisible = Boolean(
    /risiko|kannibalis|tool|rechner|reserved|schutz|duplikat|duplicate/i.test(`${briefingText} ${qaHintsText}`)
    || reservedSlugHit
    || protectedTopicMentioned
    || action
  );

  return [
    makeCheck(
      "intent",
      "Intent erfüllt",
      Boolean(expectedIntent && (bodyText.toLowerCase().includes(String(keyword).toLowerCase().split(" ")[0] || "") || titleText.toLowerCase().includes(String(keyword).toLowerCase().split(" ")[0] || ""))),
      "critical",
      expectedIntent
        ? `Intent/Keyword erkennbar: ${String(expectedIntent).slice(0, 120)}`
        : "Kein Ziel-Intent im Briefing oder Keyword ableitbar.",
      { expectedIntent: String(expectedIntent || "").slice(0, 220), keyword }
    ),
    makeCheck(
      "no_tool_cannibalization",
      "Keine Tool-Kannibalisierung",
      !reservedSlugHit,
      "critical",
      reservedSlugHit
        ? `Slug "${articleSlug}" ist geschützt und darf nicht als Blog-Draft verwendet werden.`
        : protectedTopicMentioned
          ? "Tool-/Rechner-Thema erkannt, aber der Blog-Slug kopiert keinen geschützten Hauptslug."
          : "Kein geschützter Tool-Slug getroffen.",
      { slug: articleSlug, protectedTopicMentioned }
    ),
    makeCheck(
      "cta_plan",
      "CTA-Plan vorhanden",
      ctaCount >= 3,
      "warning",
      ctaCount >= 3
        ? `${ctaCount} CTA-Elemente gefunden.`
        : `Nur ${ctaCount} CTA-Elemente gefunden, erwartet sind mindestens 3.`,
      { ctaCount }
    ),
    makeCheck(
      "internal_links",
      "Interne Links passend",
      internalLinkCount >= 1 || allLinkCount >= 3,
      "warning",
      internalLinkCount >= 1 || allLinkCount >= 3
        ? `${internalLinkCount} interne Linkelemente und ${allLinkCount} Links gefunden.`
        : "Zu wenig interne Vernetzung im Draft.",
      { internalLinkCount, allLinkCount }
    ),
    makeCheck(
      "meta",
      "Meta sauber",
      Boolean(article.title_tag && article.title_tag.length <= 60 && article.meta_description && article.meta_description.length <= 155 && articleSlug.length >= 6),
      "critical",
      "Title, Meta Description und Slug geprüft.",
      { titleTagLength: article.title_tag?.length || 0, metaLength: article.meta_description?.length || 0, slug: articleSlug }
    ),
    makeCheck(
      "social_gbp",
      "Social und GBP vorbereitet",
      hasSocial && hasGbp,
      "warning",
      hasSocial && hasGbp
        ? "LinkedIn, Facebook und GBP-Text sind vorbereitet."
        : "Social- oder GBP-Entwurf fehlt oder ist zu kurz.",
      { hasLinkedIn: Boolean(social?.linkedin), hasFacebook: Boolean(social?.facebook), gbpLength: article.gbp_text?.length || 0 }
    ),
    makeCheck(
      "risk_visible",
      "Risiko sichtbar",
      riskVisible,
      "warning",
      riskVisible
        ? "Risiko- oder Empfehlungskontext ist im Gate sichtbar."
        : "Kein Risiko-/Empfehlungskontext am Draft hinterlegt.",
      { recommendation: action, hasQaHints: Boolean(context.override?.qaHints) }
    ),
  ];
}

function buildGateResult(article, seo, settings, context, baseIssues, llmNote) {
  const checks = buildGateChecks(article, seo, settings, context);
  const failed = checks.filter((check) => !check.passed);
  const criticalFailures = failed.filter((check) => check.severity === "critical");
  const penalty = failed.reduce((sum, check) => sum + checkWeight(check), 0);
  const score = Math.max(0, Math.min(10, Math.round(10 - penalty)));
  return {
    version: "draft_gate_v1",
    score,
    status: criticalFailures.length ? "needs_revision" : failed.length ? "review" : "ready_for_approval",
    autopublish_allowed: false,
    autopublish_reason: "Review-Draft-Gate aktiv: Veröffentlichung bleibt ein separater Freigabeschritt.",
    checks,
    failed_checks: failed.map((check) => check.id),
    issues: baseIssues,
    llmNote,
  };
}

/**
 * @param {object} article - Fertiger Artikel (body_html, title, title_tag, meta_description, gbp_text, slug)
 * @param {object} seo     - { primaryKeyword }
 * @param {object} settings - Decrypted tenant settings
 * @param {object} sysConfig - Global feature flags
 * @returns {{ score: number, issues: string[], llmNote: string|null }}
 */
export async function runQA(article, seo, settings, sysConfig = {}, context = {}) {
  const issues = [];
  const body = article.body_html || "";
  const keyword = seo.primaryKeyword || "";

  // --- REGEL-CHECKS ---

  // SEO: Keyword in erstem <h2>
  const firstH2Match = body.match(/<h2[^>]*>(.*?)<\/h2>/is);
  const firstH2 = firstH2Match ? firstH2Match[1].replace(/<[^>]+>/g, "") : "";
  if (keyword && !firstH2.toLowerCase().includes(keyword.toLowerCase())) {
    issues.push(`SEO: Keyword "${keyword}" fehlt im ersten <h2>`);
  }

  // SEO: Keyword in letztem <h2>
  const allH2s = [...body.matchAll(/<h2[^>]*>(.*?)<\/h2>/gis)];
  const lastH2Text = allH2s.length > 0
    ? allH2s[allH2s.length - 1][1].replace(/<[^>]+>/g, "")
    : "";
  if (keyword && allH2s.length > 1 && !lastH2Text.toLowerCase().includes(keyword.toLowerCase())) {
    issues.push(`SEO: Keyword "${keyword}" fehlt im letzten <h2> (Fazit)`);
  }

  // Content-Bausteine: SEO-Booster-Artikel brauchen echte UX-Struktur.
  const blockCount = CONTENT_BLOCKS.filter(cls => body.includes(cls)).length;
  if (blockCount < 5) {
    issues.push(`Struktur: Nur ${blockCount} Content-Bausteine (min. 5 erwartet: Tabelle, Callout, CTA, Ablauf/Checkliste)`);
  }
  if (!/<table\b/i.test(body) && !body.includes("comparison-table")) {
    issues.push("Struktur: Vergleichs- oder Übersichtstabelle fehlt");
  }
  if (!body.includes("process-steps")) {
    issues.push("Struktur: Schritt-für-Schritt-Block fehlt");
  }
  if (!body.includes("check-list")) {
    issues.push("Struktur: Checkliste fehlt");
  }

  // Offene Platzhalter
  if (body.includes("<!-- IMAGE_2 -->")) {
    issues.push("Bild: <!-- IMAGE_2 --> nicht ersetzt (Bild-Generierung fehlgeschlagen?)");
  }
  if (body.includes("<!-- CHART -->")) {
    issues.push("Chart: <!-- CHART --> nicht ersetzt (QuickChart-Fehler?)");
  }

  // Wortanzahl
  const wordCount = stripHtml(body).split(/\s+/).filter(Boolean).length;
  const minWords = { short: 450, medium: 800, long: 1200, detailed: 1700 }[settings.post_length || "medium"] || 800;
  if (wordCount < minWords * 0.75) {
    issues.push(`Länge: Nur ~${wordCount} Wörter (erwartet min. ${Math.round(minWords * 0.75)})`);
  }

  // GBP-Text-Länge
  if (article.gbp_text && article.gbp_text.length > 280) {
    issues.push(`GBP-Text: ${article.gbp_text.length} Zeichen (max. 280)`);
  }

  // Title Tag
  if (article.title_tag && article.title_tag.length > 60) {
    issues.push(`Title-Tag: ${article.title_tag.length} Zeichen (max. 60)`);
  }

  // Meta Description
  if (article.meta_description && article.meta_description.length > 155) {
    issues.push(`Meta-Description: ${article.meta_description.length} Zeichen (max. 155)`);
  }

  // Regelbasierter Score: start 10, -1.5 pro Issue (min 0)
  const ruleScore = Math.max(0, Math.round(10 - issues.length * 1.5));

  // --- OPTIONALER LLM-CHECK ---
  let llmScore = null;
  let llmNote = null;

  if (sysConfig.features?.qa_llm_enabled) {
    try {
      const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1200);
      const prompt = `Bewerte diesen Blog-Artikel kurz als Qualitäts-Checker.

TITEL: ${article.title}
SEO-KEYWORD: ${keyword}
ARTIKEL-AUSZUG: ${snippet}

Gib NUR JSON zurück: { "score": 1-10, "note": "max 2 Sätze Qualitätsfeedback" }
Bewertungskriterien: Mehrwert für Leser, natürliche Keyword-Integration, Tonalität, kein KI-Kitsch.`;

      const raw = await generateText(settings, "Du bist ein SEO-Content-Qualitätsprüfer.", prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        let parsed;
        try { parsed = JSON.parse(match[0]); }
        catch { parsed = JSON.parse(jsonrepair(match[0])); }
        llmScore = Math.min(10, Math.max(0, Number(parsed.score) || ruleScore));
        llmNote = parsed.note || null;
      }
    } catch {
      // LLM-Check ist optional — kein Blocker
    }
  }

  // Finaler Score: LLM wenn vorhanden (70/30 gewichtet mit Rule), sonst Rule
  const score = llmScore !== null
    ? Math.round(ruleScore * 0.3 + llmScore * 0.7)
    : ruleScore;

  const gate = buildGateResult(article, seo, settings, context, issues, llmNote);
  const combinedScore = context.reviewMode
    ? Math.min(score, gate.score)
    : Math.round(score * 0.6 + gate.score * 0.4);
  const adjustedStatus = combinedScore < 6
    ? "needs_revision"
    : combinedScore < 8
      ? "review"
      : gate.status;
  const gateIssues = gate.checks
    .filter((check) => !check.passed)
    .map((check) => `Gate: ${check.label}: ${check.message}`);

  return {
    score: combinedScore,
    issues: [...issues, ...gateIssues],
    llmNote,
    gate: { ...gate, score: combinedScore, content_score: score, status: adjustedStatus },
  };
}
