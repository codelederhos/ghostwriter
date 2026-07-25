/**
 * Recherche-Step: Holt aktuelle Fakten via SearXNG (selbst-gehostet, kein API-Key)
 * Fallback: Tavily wenn TAVILY_API_KEY gesetzt.
 * Gibt strukturierte { facts, sources, referenceImageUrls } zurück.
 *
 * Datums-Regel: NUR Inhalte der letzten 6 Monate (180 Tage)
 */

import { generateText } from "../../providers/text.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://openclaw-searxng:8080";
const MAX_AGE_DAYS = 180; // Daten nicht älter als 6 Monate

const EXCLUDED_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "youtube.com", "reddit.com", "amazon.com", "ebay.com", "etsy.com",
  "duden.de", "gmx.net", "gmx.de", "web.de", "idealo.de", "cyberport.de",
  "backmarket.de", "backmarket.com", "kleinanzeigen.de",
];

// Keyword-Match-Müll: Login-Seiten, Shops, Wörterbuch-Einträge, Filme.
// Solche "Quellen" entstehen, wenn die Suche nur das nackte Keyword trifft
// (z.B. "It (2017 film)" für IT, GMX-Login für "Mitarbeiter", Duden für "Recht").
const TRASH_TITLE_RE = /login|sign.?in|anmelden|passwort|konto erstellen|rechtschreibung|wörterbuch|\(\d{4} film\)|– wikipedia|- wikipedia|shop|kaufen|angebote|preisvergleich|gutschein/i;

function isTrashSource(r) {
  const title = String(r.title || "");
  return TRASH_TITLE_RE.test(title);
}

/**
 * LLM-Relevanzfilter: behält nur Quellen, die fachlich zum Artikel-Thema passen.
 * Verhindert Keyword-Müll, den die Titel-Blacklist nicht erwischt
 * (z.B. Kieler Konkurrenz-Fotografen in einem Amberger Artikel).
 */
async function filterRelevantSources(settings, topic, sources) {
  if (sources.length === 0) return sources;
  try {
    const list = sources.map(s => `${s.id}: ${s.title} (${s.url})`).join("\n");
    const raw = await generateText(
      settings,
      "Du bewertest Quellen für einen Fachartikel. Antworte NUR mit einem JSON-Array der Nummern, sonst nichts.",
      `Artikel-Thema: "${topic}"\n\nWelche dieser Quellen sind fachlich passende, seriöse Belege für diesen Artikel? Aussortieren: Login-/Shop-/Wörterbuch-Seiten, Filme, themenfremde Treffer und direkte lokale Konkurrenz-Anbieter.\n\n${list}\n\nJSON-Array der passenden Nummern:`
    );
    const keep = new Set((String(raw).match(/\d+/g) || []).map(Number));
    if (keep.size === 0) return [];
    return sources.filter(s => keep.has(s.id));
  } catch {
    return sources; // Filter-Fehler darf die Pipeline nicht stoppen
  }
}

/**
 * @param {object} settings - Tenant settings (research_enabled via system_config)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {object} seo - SEO output (primaryKeyword)
 * @returns {{ facts: string, sources: Array<{id,url,title}>, referenceImageUrls: string[] }|null}
 */
export async function runResearch(settings, plan, seo) {
  if (!settings.research_enabled) return null;

  // Suchanfrage mit Fach-Kontext, damit nicht das nackte Keyword gematcht wird
  const queryStr = `${seo.primaryKeyword} ${plan.categoryLabel} Ratgeber aktuell ${new Date().getFullYear()}`.trim();

  // Tavily bevorzugen wenn Key vorhanden (bessere Qualität)
  const result = process.env.TAVILY_API_KEY ? await runTavily(queryStr) : await runSearXNG(queryStr);
  if (!result) return null;

  // Relevanz-Gate: lieber KEINE Quellen als Keyword-Müll im Artikel
  const topic = `${seo.primaryKeyword} (${plan.categoryLabel || ""})`;
  const kept = await filterRelevantSources(settings, topic, result.sources);
  if (kept.length < 2) return null;
  const keptIds = new Set(kept.map(s => s.id));
  const facts = String(result.facts || "")
    .split("\n\n")
    .filter(f => { const m = f.match(/^\[(\d+)\]/); return !m || keptIds.has(Number(m[1])); })
    .join("\n\n");
  // IDs neu durchnummerieren, damit die Fußnoten lückenlos sind
  const renumbered = kept.map((s, i) => ({ ...s, id: i + 1 }));
  let renumberedFacts = facts;
  kept.forEach((s, i) => {
    renumberedFacts = renumberedFacts.replace(new RegExp(`^\\[${s.id}\\]`, "m"), `[${i + 1}]`);
  });
  return { ...result, sources: renumbered, facts: renumberedFacts };
}

async function runSearXNG(queryStr) {
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      q: queryStr,
      format: "json",
      categories: "general",
      language: "de",
      time_range: "year", // SearXNG: nur letztes Jahr (engster Filter verfügbar)
    });

    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const sources = [];
    const facts = [];
    const referenceImageUrls = [];

    for (const r of (data.results || []).slice(0, 12)) {
      let domain;
      try { domain = new URL(r.url).hostname; } catch { continue; }
      if (EXCLUDED_DOMAINS.some(d => domain.includes(d))) continue;
      if (isTrashSource(r)) continue;

      // Datumsfilter: Result älter als 6 Monate überspringen
      if (r.publishedDate) {
        const pub = new Date(r.publishedDate);
        if (!isNaN(pub.getTime()) && pub < cutoff) continue;
      }

      const text = r.content || "";
      if (!text.trim()) continue;
      if (sources.length >= 7) break;

      const id = sources.length + 1;
      sources.push({ id, url: r.url, title: r.title || r.url });
      facts.push(`[${id}] ${text.trim().slice(0, 700)}`);

      // Bild-URL für Referenz merken (wenn vorhanden)
      if (r.img_src && !referenceImageUrls.includes(r.img_src)) {
        referenceImageUrls.push(r.img_src);
      }
    }

    if (sources.length === 0) return null;
    return { facts: facts.join("\n\n"), sources, referenceImageUrls: referenceImageUrls.slice(0, 3) };
  } catch {
    return null;
  }
}

async function runTavily(queryStr) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: queryStr,
        max_results: 8,
        search_depth: "advanced", // Tiefere Recherche
        include_answer: true,
        include_images: true,     // Referenzbilder aus Suche
        days: MAX_AGE_DAYS,       // Nur Daten der letzten 6 Monate
        exclude_domains: EXCLUDED_DOMAINS,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const sources = [];
    const facts = [];

    if (data.answer) facts.push(`Aktuelle Zusammenfassung: ${data.answer}`);

    for (const r of (data.results || []).slice(0, 10)) {
      const text = r.content || r.snippet || "";
      if (!text.trim()) continue;
      if (isTrashSource(r)) continue;
      if (sources.length >= 7) break;
      const id = sources.length + 1;
      sources.push({ id, url: r.url, title: r.title || r.url });
      facts.push(`[${id}] ${text.trim().slice(0, 700)}`);
    }

    if (sources.length === 0) return null;

    // Referenzbilder aus Tavily image results
    const referenceImageUrls = (data.images || []).slice(0, 3)
      .map(img => (typeof img === "string" ? img : img?.url))
      .filter(Boolean);

    return { facts: facts.join("\n\n"), sources, referenceImageUrls };
  } catch {
    return null;
  }
}
