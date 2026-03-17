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
export async function runWriter(settings, plan, seo, profile, language, researchFacts = null) {
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

  const wordRange = { short: "300–500", medium: "500–800", long: "800–1200", detailed: "1200–1800" }[settings.post_length || "medium"];
  const isRich = (settings.post_length === "long" || settings.post_length === "detailed");

  const researchBlock = researchFacts
    ? `\nRECHERCHE-FAKTEN (einbauen wo passend, NICHT erfinden):\n${researchFacts.slice(0, 2000)}\n`
    : "";

  const imageStyleHint = settings.image_style_prefix
    ? `VISUELLER STIL (für Bild-Prompts): ${settings.image_style_prefix}`
    : "";

  const userPrompt = `FIRMENPROFIL:
${profileJson}
${imageStyleHint}

KATEGORIE: ${plan.categoryLabel} — ${plan.categoryDesc}
ANGLE: ${plan.angleName} — ${plan.angleDesc}
SAISON: ${plan.seasonDesc}
SPRACHE: ${langName}
SEO-KEYWORD: ${seo.primaryKeyword}
SEKUNDÄRE KEYWORDS: ${seo.secondaryKeywords.join(", ")}
${researchBlock}
SEO-STRUKTUR-REGELN für H2/H3:
- Keyword "${seo.primaryKeyword}" im ERSTEN <h2> (Pflicht)
- Keyword "${seo.primaryKeyword}" im LETZTEN <h2> (Fazit/Zusammenfassung, Pflicht)
- Keyword oder Variante in mindestens 50% aller <h2>
- Sekundäre Keywords in 30% der <h3>
${isRich ? `- Vorletzter <h2>: FAQ-Sektion mit min. 5 Fragen als <details><summary>` : ""}

REGELN für body_html:
- ${wordRange} Wörter Fließtext
- Sprache: ${langName}, ${profile?.brand_voice || "professionell aber nahbar"}
- Kein ALL CAPS, keine Floskeln
- Konkreter Mehrwert für den Leser
- SEO: Hauptkeyword 2–3x natürlich einbauen
- Struktur: <h2>-Abschnitte, <p>-Absätze, <strong> für Kernaussagen
${isRich ? `- Füge eine FAQ-Sektion ein: <details><summary>Frage?</summary><p>Antwort</p></details> (3–5 Fragen)
- Füge an passender Stelle <!-- IMAGE_2 --> als Platzhalter für ein Foto ein
- Füge 2–3 Quellenangaben ein als: <a href="URL" class="source-pill" target="_blank" rel="noopener">Quellname</a>
- Optional: eine Vergleichs-/Übersichtstabelle als <table class="comparison-table"><thead>...</thead><tbody>...</tbody></table>` : "- Füge <!-- IMAGE_2 --> als Platzhalter für ein Foto ein"}
- Endet mit Call-to-Action
- Liefere auch: title_tag (max 60 Zeichen), meta_description (max 155 Zeichen), slug
- social_text: Kurzer prägnanter Text max 280 Zeichen für Social Media / GBP (kein Hashtag, 1 Emoji max)

Antworte NUR im JSON-Format:
{
  "title": "...",
  "title_tag": "...",
  "meta_description": "...",
  "slug": "...",
  "body_html": "...",
  "primary_keyword": "...",
  "social_text": "...",
  "image_prompt_1": "English image prompt for the title image. Use the company's industry (${profile?.industry || "business"}), region (${profile?.region || ""}), and article topic. 16:9 ratio, photorealistic, no text, no faces, no logos. Max 120 chars. Describe a concrete scene/mood matching the article.",
  "image_prompt_2": "English image prompt for a second article image. Different angle/perspective than image_prompt_1. Same rules: industry context, photorealistic, no text, no faces. Max 120 chars."
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

  // social_text als Fallback kürzen
  if (!article.social_text) {
    article.social_text = article.title;
  }
  if (article.social_text.length > 280) {
    article.social_text = article.social_text.slice(0, 277) + "...";
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

  article.gbp_text = gbpText;

  return article;
}
