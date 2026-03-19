/**
 * Step REFRESH: CONTENT REFRESH BOT
 * Aktualisiert einen bestehenden Artikel mit neuen Daten.
 * Aktivierbar per tenant_settings.refresh_enabled.
 *
 * Ablauf:
 *   1. Research-Step neu ausführen (selbes Keyword)
 *   2. Writer im Update-Modus: bestehenden Content als Kontext übergeben
 *   3. Nur neue Fakten + veraltete Zahlen aktualisieren — kein Rewrite
 *   4. dateModified + updated_at + refresh_count updaten
 *
 * Kosten: refresh_discount_percent aus system_config.pricing (default 40% Rabatt)
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://openclaw-searxng:8080";

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} post - ghostwriter_posts record
 * @param {object} profile - Tenant profile
 * @returns {{ body_html, meta_description, blog_title, gbp_text } | null} - Null bei Fehler
 */
export async function runRefresher(settings, post, profile) {
  // 1. Neue Recherche mit dem Original-Keyword
  let newFacts = null;
  const keyword = post.blog_primary_keyword;

  if (keyword) {
    try {
      newFacts = await researchForRefresh(keyword, profile?.region);
    } catch { /* Recherche fehlgeschlagen — trotzdem updaten */ }
  }

  const year = new Date().getFullYear();
  const researchSection = newFacts
    ? `\nNEUE FAKTEN UND DATEN (Stand ${year}) — einbauen wo veraltet:\n${newFacts.slice(0, 2000)}\n`
    : "";

  // 2. Writer im Update-Modus
  const systemPrompt = `Du bist ein SEO-Content-Texter. Du aktualisierst einen bestehenden Artikel — kein Rewrite, nur gezielte Verbesserungen.`;

  const userPrompt = `AUFGABE: Aktualisiere diesen Artikel für das Jahr ${year}.

BESTEHENDER ARTIKEL-TITEL: "${post.blog_title}"
PRIMÄRES KEYWORD: "${keyword}"
BRANCHE: ${profile?.industry || "Immobilien"}
REGION: ${profile?.region || ""}
${researchSection}
BESTEHENDER ARTIKEL-BODY (HTML):
${(post.blog_body || "").slice(0, 4000)}

REGELN:
- Veraltete Jahreszahlen (${year - 1}, ${year - 2}) auf ${year} aktualisieren
- Neue Fakten an passenden Stellen einbauen (als stat-widget oder in Fließtext)
- Ton und Struktur beibehalten — kein Rewrite
- Wenn neue Fakten nicht passen: unverändert lassen
- body_html darf nicht kürzer als das Original sein

Antworte NUR als JSON:
{
  "body_html": "...",
  "meta_description": "...",
  "blog_title": "...",
  "gbp_text": "..."
}`;

  const raw = await generateText(settings, systemPrompt, userPrompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let result;
  try { result = JSON.parse(jsonMatch[0]); }
  catch { result = JSON.parse(jsonrepair(jsonMatch[0])); }

  if (!result.body_html) return null;
  return result;
}

async function researchForRefresh(keyword, region = "") {
  const queryStr = `${keyword} ${region} aktuell ${new Date().getFullYear()}`.trim();

  // Tavily bevorzugen
  if (process.env.TAVILY_API_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: queryStr, max_results: 5, search_depth: "basic" }),
      });
      const data = await res.json();
      return (data.results || []).slice(0, 5).map(r => `${r.title}: ${r.content}`).join("\n\n");
    } catch { /* Fallback zu SearXNG */ }
  }

  // SearXNG Fallback
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(queryStr)}&format=json&language=de&time_range=year`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  return (data.results || []).slice(0, 5).map(r => `${r.title}: ${r.content || r.url}`).join("\n\n");
}
