/**
 * Step 2: SEO RESEARCHER
 * Generates SEO keywords and research for the planned topic
 */

import { generateText } from "../../providers/text.js";

const LANG_NAMES = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español",
  it: "Italiano", nl: "Nederlands", pt: "Português",
};

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} plan - Output from planner step
 * @param {object} profile - Tenant profile
 * @param {string} language - Target language code
 * @returns {object} { primaryKeyword, secondaryKeywords, searchIntent }
 */
export async function runSeoResearch(settings, plan, profile, language) {
  const langName = LANG_NAMES[language] || language;

  const systemPrompt = `Du bist ein SEO-Experte. Deine Aufgabe: Finde das beste Keyword für einen Blog-Artikel.
Antworte NUR im JSON-Format, keine Erklärungen.`;

  const userPrompt = `Finde SEO-Keywords für folgenden Artikel:

BRANCHE: ${profile?.industry || "Immobilien"}
REGION: ${profile?.region || "Deutschland"}
THEMA: ${plan.categoryLabel} — ${plan.categoryDesc}
BLICKWINKEL: ${plan.angleName} — ${plan.angleDesc}
SPRACHE: ${langName}

Antworte im JSON-Format:
{
  "primaryKeyword": "das wichtigste Keyword (2-4 Wörter, ${langName})",
  "secondaryKeywords": ["keyword2", "keyword3", "keyword4"],
  "searchIntent": "informational|transactional|navigational",
  "suggestedTitle": "Ein SEO-optimierter Titel-Vorschlag (${langName})"
}`;

  const raw = await generateText(settings, systemPrompt, userPrompt);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in SEO response");
    const result = JSON.parse(jsonMatch[0]);
    return {
      primaryKeyword: result.primaryKeyword || plan.categoryLabel,
      secondaryKeywords: result.secondaryKeywords || [],
      searchIntent: result.searchIntent || "informational",
      suggestedTitle: result.suggestedTitle || "",
    };
  } catch (err) {
    // Fallback: use category as keyword
    return {
      primaryKeyword: plan.categoryLabel,
      secondaryKeywords: [],
      searchIntent: "informational",
      suggestedTitle: "",
    };
  }
}
