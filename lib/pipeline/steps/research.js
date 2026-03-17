/**
 * Recherche-Step: Holt aktuelle Fakten via SearXNG (selbst-gehostet, kein API-Key)
 * Fallback: Tavily wenn TAVILY_API_KEY gesetzt.
 * Gibt strukturierte { facts, sources } zurück für Quellenangaben.
 */

const SEARXNG_URL = process.env.SEARXNG_URL || "http://openclaw-searxng:8080";

const EXCLUDED_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "youtube.com", "reddit.com", "amazon.com", "ebay.com", "etsy.com",
];

/**
 * @param {object} settings - Tenant settings (research_enabled via system_config)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {object} seo - SEO output (primaryKeyword)
 * @returns {{ facts: string, sources: Array<{id,url,title}> }|null}
 */
export async function runResearch(settings, plan, seo) {
  if (!settings.research_enabled) return null;

  const queryStr = `${seo.primaryKeyword} ${plan.categoryLabel} ${plan.angleName}`.trim();

  // Tavily bevorzugen wenn Key vorhanden (bessere Qualität)
  if (process.env.TAVILY_API_KEY) {
    return runTavily(queryStr);
  }

  // SearXNG (selbst-gehostet, immer verfügbar)
  return runSearXNG(queryStr);
}

async function runSearXNG(queryStr) {
  try {
    const params = new URLSearchParams({
      q: queryStr,
      format: "json",
      categories: "general",
      language: "de",
    });

    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const sources = [];
    const facts = [];

    for (const r of (data.results || []).slice(0, 6)) {
      const domain = new URL(r.url).hostname;
      if (EXCLUDED_DOMAINS.some(d => domain.includes(d))) continue;
      const text = r.content || "";
      if (!text.trim()) continue;
      const id = sources.length + 1;
      sources.push({ id, url: r.url, title: r.title || r.url });
      facts.push(`[${id}] ${text.trim().slice(0, 600)}`);
    }

    if (sources.length === 0) return null;
    return { facts: facts.join("\n\n"), sources };
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
        max_results: 6,
        search_depth: "basic",
        include_answer: true,
        exclude_domains: EXCLUDED_DOMAINS,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const sources = [];
    const facts = [];

    if (data.answer) facts.push(`Zusammenfassung: ${data.answer}`);

    for (const [i, r] of (data.results || []).slice(0, 6).entries()) {
      const text = r.content || r.snippet || "";
      if (!text.trim()) continue;
      const id = sources.length + 1;
      sources.push({ id, url: r.url, title: r.title || r.url });
      facts.push(`[${id}] ${text.trim().slice(0, 600)}`);
    }

    if (sources.length === 0) return null;
    return { facts: facts.join("\n\n"), sources };
  } catch {
    return null;
  }
}
