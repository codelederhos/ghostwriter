/**
 * Step 5c: KORREKTUR-BOT
 * Wird aufgerufen wenn QA-Score < 8 (gelb oder rot).
 * Zwei Schichten:
 *   1. Regelbasierte Fixes (kein LLM, gratis): Längenüberschreitungen
 *   2. LLM-Fixes (1 gezielter Call): H2-Keywords, fehlende Content-Bausteine
 *
 * Gibt ein Patch-Objekt zurück das auf article gemergt wird.
 * Verändert NUR was kaputt ist — kein Rewrite des gesamten Artikels.
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

const CONTENT_BLOCKS = [
  "callout", "stat-grid", "compare-block", "process-steps",
  "check-list", "cross-list", "highlight-quote", "comparison-table",
];

/**
 * @param {object} article   - Fertiger Artikel
 * @param {object} seo       - { primaryKeyword }
 * @param {object} profile   - Tenant-Profil (für Kontext)
 * @param {string[]} issues  - Issue-Liste aus runQA()
 * @param {object} settings  - Decrypted tenant settings
 * @returns {object} Partielle Fixes { body_html?, title_tag?, meta_description?, gbp_text? }
 */
export async function runCorrector(article, seo, profile, issues, settings) {
  const fixes = {};

  // --- 1. REGELBASIERTE FIXES (kein LLM) ---
  if (article.gbp_text?.length > 280) {
    fixes.gbp_text = article.gbp_text.slice(0, 277) + "...";
  }
  if (article.title_tag?.length > 60) {
    fixes.title_tag = article.title_tag.slice(0, 57) + "...";
  }
  if (article.meta_description?.length > 155) {
    fixes.meta_description = article.meta_description.slice(0, 152) + "...";
  }

  // --- 2. LLM-FIXES (strukturelle Probleme + Wortanzahl) ---
  const llmIssues = issues.filter(i =>
    i.includes("Keyword") || i.includes("Bausteine") || i.includes("Länge:")
  );
  if (llmIssues.length === 0) return fixes;

  // Wortanzahl-Expansion: separate LLM-Call der einen neuen Abschnitt liefert
  const wordCountIssue = llmIssues.find(i => i.includes("Länge:"));
  if (wordCountIssue) {
    const targetWords = { short: 400, medium: 650, long: 1000, detailed: 1500 }[settings.post_length || "medium"];
    const currentWords = article.body_html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    const missing = Math.max(0, targetWords - currentWords);

    if (missing > 50) {
      try {
        const expansionPrompt = `Du bist ein SEO-Content-Texter. Schreibe einen zusätzlichen Abschnitt für diesen Artikel.

ARTIKEL-TITEL: "${article.title}"
SEO-KEYWORD: "${seo.primaryKeyword}"
BRANCHE: ${profile?.industry || "Immobilien"}
REGION: ${profile?.region || ""}

Der Artikel ist zu kurz (~${currentWords} Wörter, Ziel: ~${targetWords}).
Schreibe einen neuen Abschnitt mit ca. ${Math.min(missing + 50, 300)} Wörtern.
Nutze h2-Überschrift + 2-3 Absätze + optional einen Content-Baustein (callout oder check-list).

Antworte NUR mit dem HTML-Inhalt des neuen Abschnitts — kein JSON, nur HTML.`;

        const newSection = await generateText(settings, "Du bist ein SEO-Content-Texter.", expansionPrompt);
        const cleanSection = newSection.replace(/```html?|```/gi, "").trim();

        // Vor dem letzten <h2> (Fazit) einfügen
        const lastH2Pos = article.body_html.lastIndexOf("<h2");
        if (lastH2Pos > 0) {
          fixes.body_html = (fixes.body_html || article.body_html).slice(0, lastH2Pos)
            + "\n" + cleanSection + "\n"
            + (fixes.body_html || article.body_html).slice(lastH2Pos);
        } else {
          fixes.body_html = (fixes.body_html || article.body_html) + "\n" + cleanSection;
        }
        // Länge-Issue aus llmIssues entfernen damit sie nicht nochmal bearbeitet wird
        llmIssues.splice(llmIssues.indexOf(wordCountIssue), 1);
      } catch { /* Expansion fehlgeschlagen — weiter */ }
    }
  }

  const structuralIssues = llmIssues.filter(i => !i.includes("Länge:"));
  if (structuralIssues.length === 0) return fixes;

  // Kontext für den LLM: nur H2-Liste + gefundene Blöcke (nicht das ganze HTML)
  const h2List = [...article.body_html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gis)]
    .map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const existingBlocks = CONTENT_BLOCKS.filter(c => article.body_html.includes(c));

  const systemPrompt = `Du bist ein SEO-Content-Korrektor. Du bekommst eine Liste von Qualitätsproblemen und korrigierst sie gezielt. Antworte immer auf ${profile?.language || "Deutsch"}.`;

  const userPrompt = `QUALITÄTSPROBLEME ZU BEHEBEN:
${structuralIssues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

KONTEXT:
- SEO-Keyword: "${seo.primaryKeyword}"
- Artikel-Titel: "${article.title}"
- Branche: ${profile?.industry || "Immobilien"}
- Aktuelle H2-Überschriften (als JSON-Array): ${JSON.stringify(h2List)}
- Vorhandene Content-Bausteine: ${existingBlocks.join(", ") || "keine"}

REGELN:
- Keyword muss NATÜRLICH in H2 eingebaut werden — kein Keyword-Stuffing
- Content-Baustein muss thematisch zum Artikel passen (Branche: ${profile?.industry || "Immobilien"})
- Ändere NUR was in den Problemen steht

Antworte NUR als JSON:
{
  "h2_fixes": [
    { "old": "exakter aktueller H2-Text", "new": "verbesserter H2-Text mit Keyword" }
  ],
  "extra_block": "HTML-Baustein (callout/stat-grid/compare-block etc.) zum Einfügen vor dem letzten H2 — NUR wenn Bausteine fehlen, sonst null"
}`;

  try {
    const raw = await generateText(settings, systemPrompt, userPrompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fixes;

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch { parsed = JSON.parse(jsonrepair(match[0])); }

    let body = article.body_html;

    // H2-Texte ersetzen (sucht nur nach dem Text-Inhalt zwischen den Tags)
    for (const fix of (parsed.h2_fixes || [])) {
      if (!fix.old || !fix.new || fix.old === fix.new) continue;
      // Escaped string-match für Sonderzeichen
      const escaped = fix.old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = body.replace(new RegExp(escaped, "i"), fix.new);
    }

    // Zusätzlicher Content-Baustein: vor letztem <h2> einfügen
    if (parsed.extra_block && typeof parsed.extra_block === "string" && parsed.extra_block !== "null") {
      const lastH2Pos = body.lastIndexOf("<h2");
      if (lastH2Pos > 0) {
        body = body.slice(0, lastH2Pos) + "\n" + parsed.extra_block + "\n" + body.slice(lastH2Pos);
      }
    }

    if (body !== article.body_html) fixes.body_html = body;
  } catch {
    // Korrektur fehlgeschlagen — weiter mit Original
  }

  return fixes;
}
