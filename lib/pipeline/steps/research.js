/**
 * Recherche-Step: Holt aktuelle Fakten via SearXNG (selbst-gehostet, kein API-Key)
 * Fallback: Tavily wenn TAVILY_API_KEY gesetzt.
 * Gibt strukturierte { facts, sources, referenceImageUrls } zurück.
 *
 * Datums-Regel: NUR Inhalte der letzten 6 Monate (180 Tage)
 */

const SEARXNG_URL = process.env.SEARXNG_URL || "http://openclaw-searxng:8080";
const MAX_AGE_DAYS = 180; // Daten nicht älter als 6 Monate

const EXCLUDED_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "youtube.com", "reddit.com", "amazon.com", "ebay.com", "etsy.com",
];

/**
 * @param {object} settings - Tenant settings (research_enabled via system_config)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {object} seo - SEO output (primaryKeyword)
 * @returns {{ facts: string, sources: Array<{id,url,title}>, referenceImageUrls: string[] }|null}
 */
export async function runResearch(settings, plan, seo) {
  if (!settings.research_enabled) return null;

  // Präzisere Suchanfrage mit Aktualitäts-Hint
  const queryStr = `${seo.primaryKeyword} ${plan.categoryLabel} aktuell ${new Date().getFullYear()}`.trim();

  // Tavily bevorzugen wenn Key vorhanden (bessere Qualität)
  if (process.env.TAVILY_API_KEY) {
    return runTavily(queryStr);
  }

  // SearXNG (selbst-gehostet, immer verfügbar)
  return runSearXNG(queryStr);
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

    for (const r of (data.results || []).slice(0, 10)) {
      const domain = new URL(r.url).hostname;
      if (EXCLUDED_DOMAINS.some(d => domain.includes(d))) continue;

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

    for (const r of (data.results || []).slice(0, 7)) {
      const text = r.content || r.snippet || "";
      if (!text.trim()) continue;
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
