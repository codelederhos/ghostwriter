/**
 * Step 3: TEXTER
 * Generates the blog article + GBP teaser text
 */

import { generateText } from "../../providers/text.js";

const LANG_NAMES = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español",
  it: "Italiano", nl: "Nederlands", pt: "Português",
};

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} plan - Output from planner
 * @param {object} seo - Output from SEO researcher
 * @param {object} profile - Tenant profile
 * @param {string} language - Target language code
 * @returns {object} { title, title_tag, meta_description, slug, body_html, gbp_text }
 */
export async function runWriter(settings, plan, seo, profile, language) {
  const langName = LANG_NAMES[language] || language;

  const profileJson = JSON.stringify({
    company: profile?.company_name,
    industry: profile?.industry,
    region: profile?.region,
    usp: profile?.usp,
    positioning: profile?.positioning,
    services: profile?.services,
    website: profile?.website_url,
  }, null, 2);

  const systemPrompt = `Du bist der Content-Manager von ${profile?.company_name || "einem Unternehmen"}.
Schreibe einen Blog-Artikel für die Website.`;

  const userPrompt = `FIRMENPROFIL:
${profileJson}

KATEGORIE: ${plan.categoryLabel} — ${plan.categoryDesc}
ANGLE: ${plan.angleName} — ${plan.angleDesc}
SAISON: ${plan.seasonDesc}
SPRACHE: ${langName}
SEO-KEYWORD: ${seo.primaryKeyword}
SEKUNDÄRE KEYWORDS: ${seo.secondaryKeywords.join(", ")}

REGELN:
- ${{ short: "300–500", medium: "500–800", long: "800–1200", detailed: "1200–1800" }[settings.post_length || "medium"]} Wörter
- Sprache: ${langName}, ${profile?.brand_voice || "professionell aber nahbar"}
- Kein ALL CAPS
- Keine Floskeln ("in der heutigen Zeit", "es ist kein Geheimnis")
- Konkreter Mehrwert für den Leser
- SEO: Hauptkeyword 2–3x natürlich einbauen
- Endet mit Call-to-Action
- Liefere auch: title_tag (max 60 Zeichen), meta_description (max 155 Zeichen), slug

Antworte im JSON-Format:
{
  "title": "...",
  "title_tag": "...",
  "meta_description": "...",
  "slug": "...",
  "body_html": "...",
  "primary_keyword": "..."
}`;

  const raw = await generateText(settings, systemPrompt, userPrompt);

  // Parse JSON from response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Writer returned no valid JSON");
  const article = JSON.parse(jsonMatch[0]);

  // Validate
  if (!article.title || !article.body_html) {
    throw new Error("Writer response missing title or body_html");
  }

  // Ensure slug is URL-safe
  article.slug = (article.slug || article.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  // Enforce title_tag length
  if (article.title_tag && article.title_tag.length > 60) {
    article.title_tag = article.title_tag.slice(0, 57) + "...";
  }

  // Enforce meta_description length
  if (article.meta_description && article.meta_description.length > 155) {
    article.meta_description = article.meta_description.slice(0, 152) + "...";
  }

  // Generate GBP teaser
  const gbpText = await generateGbpTeaser(settings, article, language);
  article.gbp_text = gbpText;

  return article;
}

async function generateGbpTeaser(settings, article, language) {
  const langName = LANG_NAMES[language] || language;

  const systemPrompt = "Du schreibst Google Business Profile Posts. Kurz, knackig, neugierig machend.";
  const userPrompt = `Fasse folgenden Blog-Artikel in max 300 Zeichen als Google Business Post zusammen.
Sprache: ${langName}
Mach neugierig, nenne den Kern-Mehrwert, ende mit Handlungsaufforderung.
Kein Hashtag, max 1 Emoji.

Blog-Titel: ${article.title}
Blog-Inhalt (Auszug): ${article.body_html.slice(0, 1000)}

Antworte NUR mit dem Post-Text. Nichts anderes.`;

  let text = await generateText(settings, systemPrompt, userPrompt);

  // Strip quotes if LLM wrapped it
  text = text.replace(/^["']|["']$/g, "").trim();

  // Hard limit
  if (text.length > 300) {
    text = text.slice(0, 297) + "...";
  }

  return text;
}
