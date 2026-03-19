/**
 * Step 5b: QUALITY-CHECK
 * Regelbasierte Qualitätsprüfung des fertigen Artikels.
 * Läuft nach Chart/Image/Backlink-Injektion, VOR dem DB-Insert.
 * Optional: LLM-Qualitätsbewertung (Feature-Flag qa_llm_enabled).
 *
 * Score 0–10 (10 = perfekt). Gespeichert in ghostwriter_posts.qa_score.
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

const CONTENT_BLOCKS = [
  "callout", "stat-grid", "compare-block", "process-steps",
  "check-list", "cross-list", "highlight-quote", "comparison-table",
  "source-pill", "data-widget",
];

/**
 * @param {object} article - Fertiger Artikel (body_html, title, title_tag, meta_description, gbp_text, slug)
 * @param {object} seo     - { primaryKeyword }
 * @param {object} settings - Decrypted tenant settings
 * @param {object} sysConfig - Global feature flags
 * @returns {{ score: number, issues: string[], llmNote: string|null }}
 */
export async function runQA(article, seo, settings, sysConfig = {}) {
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

  // Content-Bausteine: mindestens 2
  const blockCount = CONTENT_BLOCKS.filter(cls => body.includes(cls)).length;
  if (blockCount < 2) {
    issues.push(`Struktur: Nur ${blockCount} Content-Bausteine (min. 2 erwartet)`);
  }

  // Offene Platzhalter
  if (body.includes("<!-- IMAGE_2 -->")) {
    issues.push("Bild: <!-- IMAGE_2 --> nicht ersetzt (Bild-Generierung fehlgeschlagen?)");
  }
  if (body.includes("<!-- CHART -->")) {
    issues.push("Chart: <!-- CHART --> nicht ersetzt (QuickChart-Fehler?)");
  }

  // Wortanzahl
  const wordCount = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const minWords = { short: 300, medium: 500, long: 800, detailed: 1200 }[settings.post_length || "medium"] || 500;
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

  return { score, issues, llmNote };
}
