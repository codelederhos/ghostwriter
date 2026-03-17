/**
 * Recherche-Step: Holt aktuelle Fakten via Tavily API.
 * Gibt strukturierte { facts, sources } zurück für Quellenangaben.
 */

const EXCLUDED_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "youtube.com", "reddit.com", "amazon.com", "ebay.com", "etsy.com",
];

/**
 * @param {object} settings - Tenant settings (research_enabled, tavily_api_key)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {object} seo - SEO output (primaryKeyword, secondaryKeywords)
 * @returns {{ facts: string, sources: Array<{id,url,title}> }|null}
 */
export async function runResearch(settings, plan, seo) {
  const apiKey = process.env.TAVILY_API_KEY || settings.tavily_api_key;
  if (!apiKey) return null;
  // research_enabled steuert ob Tavily genutzt wird — API-Key allein reicht nicht
  if (!settings.research_enabled) return null;

  const queryStr = `${seo.primaryKeyword} ${plan.categoryLabel} ${plan.angleName}`.trim();

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
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
