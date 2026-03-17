/**
 * Recherche-Step: Holt aktuelle Fakten via Tavily API.
 * Nur aktiv wenn settings.research_enabled = true und TAVILY_API_KEY gesetzt.
 */

const EXCLUDED_DOMAINS = [
  "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
  "youtube.com", "reddit.com", "amazon.com", "ebay.com", "etsy.com",
];

/**
 * @param {object} settings - Tenant settings (research_enabled, tavily_api_key)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {object} seo - SEO output (primaryKeyword, secondaryKeywords)
 * @returns {string|null} Recherche-Fakten als Text oder null
 */
export async function runResearch(settings, plan, seo) {
  const apiKey = process.env.TAVILY_API_KEY || settings.tavily_api_key;
  if (!settings.research_enabled || !apiKey) return null;

  const query = `${seo.primaryKeyword} ${plan.categoryLabel} ${plan.angleName}`.trim();

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: true,
        exclude_domains: EXCLUDED_DOMAINS,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const snippets = [];
    if (data.answer) snippets.push(`Zusammenfassung: ${data.answer}`);

    for (const r of (data.results || []).slice(0, 5)) {
      const text = r.content || r.snippet || "";
      if (text.trim()) snippets.push(text.trim().slice(0, 600));
    }

    return snippets.length > 0 ? snippets.join("\n\n") : null;
  } catch {
    return null;
  }
}
