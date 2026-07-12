/**
 * Step: SOCIAL WRITER
 * Generates LinkedIn + Facebook posts from a finished blog article.
 * Output: { linkedin: string, facebook: string }
 *
 * Wird nach Writer/Antikitsch aufgerufen. Schreibt JSON in
 * ghostwriter_posts.social_text (JSONB).
 */

import { generateText } from "../../providers/text.js";

const LANG_NAMES = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español",
  it: "Italiano", nl: "Nederlands", pt: "Português",
};

// Em-Dash bzw. typografische Gedankenstriche raus
const DASH_REGEX = /\s*[—–]\s*/g;

function stripFences(s) {
  return String(s || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function clip(s, max) {
  if (!s) return "";
  s = s.replace(DASH_REGEX, ": ").trim();
  if (s.length <= max) return s;
  // an Satzgrenze kürzen falls möglich
  const cut = s.slice(0, max);
  const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastDot > max * 0.6) return cut.slice(0, lastDot + 1);
  return cut.slice(0, max - 1).trimEnd() + "…";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} settings - Decrypted tenant settings (for provider+key+model)
 * @param {object} article - { title, body_html, ... } aus Writer
 * @param {object} seo - { primaryKeyword, secondaryKeywords }
 * @param {object} profile - Tenant profile (company_name, industry, region, brand_voice)
 * @param {string} language - 'de' | 'en' | ...
 * @returns {Promise<{linkedin: string, facebook: string}>}
 */
export async function runSocialWriter(settings, article, seo, profile, language = "de") {
  const langName = LANG_NAMES[language] || language;
  const company = profile?.company_name || "uns";
  const brandVoice = profile?.brand_voice || "professionell aber nahbar";
  const keyword = seo?.primaryKeyword || "";
  const title = article?.title || "";
  const bodyText = htmlToText(article?.body_html).slice(0, 3500);

  const isDe = language === "de";

  const systemPrompt = isDe
    ? `Du bist Social-Media-Manager für ${company}. Du schreibst LinkedIn-, Facebook- und Google-Business-Posts in ${langName}.
Tonalität: ${brandVoice}. Schreibe wie ein Mensch, nicht wie eine KI.

HARTE REGELN:
- Deutsche Rechtschreibung (Deutschland): ä, ö, ü und ß IMMER korrekt (Maßnahmen, regelmäßig, größte). Niemals ae/oe/ue, niemals Schweizer ss.
- Keine Gedankenstriche (—, –) und KEINE Doppelpunkte als Gedankenstrich-Ersatz mitten im Satz ("ist: und dass" ist FALSCH). Formuliere stattdessen zwei kurze Sätze.
- Zahlenbereiche mit Bis-Strich schreiben: "3–5 Stunden", "40–60 %". NIEMALS "3: 5 Stunden".
- ERFINDE NIEMALS Fakten über ${company}: keine Audit-, Projekt- oder Kundenzahlen, keine Referenzen, keine Checklisten oder Angebote. Nutze ausschließlich Fakten aus dem Artikel-Auszug.
- KEIN KI-Sprech: "In der heutigen Zeit", "Es ist kein Geheimnis", "nicht nur sondern auch", "ganzheitlich", "maßgeschneidert", "Herzstück", "auf Augenhöhe", "Leidenschaft für".
- Keine Hashtag-Wolken in Volltexten. Keine generischen Phrasen.
- Antworte ausschließlich mit gültigem JSON. Keine Erklärung. Keine Code-Fences.`
    : `You are the social media manager for ${company}. You write LinkedIn, Facebook and Google Business posts in ${langName}.
Tone: ${brandVoice}. Write like a human, not like AI.

HARD RULES:
- No em-dash (—) or en-dash (–) as sentence interrupters, and NEVER a colon as a dash substitute mid-sentence. Prefer two short sentences.
- Number ranges use an en-dash: "3–5 hours". Never "3: 5 hours".
- NEVER invent facts about ${company}: no audit/project/client counts, references, checklists or offers. Only use facts from the article excerpt.
- No AI cliches: "In today's world", "It's no secret", "not only but also", "holistic", "seamlessly", "tailored", "at the heart of".
- No hashtag walls inside the body text.
- Respond with valid JSON only. No explanation. No code fences.`;

  const userPrompt = isDe
    ? `Erzeuge drei Social-Posts zum folgenden Blog-Artikel.

ARTIKEL-TITEL: ${title}
HAUPT-KEYWORD: ${keyword}
ARTIKEL-AUSZUG: ${bodyText}

LINKEDIN-POST:
- Zielgruppe: Profis, Entscheider, Branchenkontext (${profile?.industry || ""}).
- Tonalität: professionell, fachlich, klar, kein Buzzword-Bingo.
- Max 1300 Zeichen.
- Erste 2 Zeilen sind ein starker Hook (Frage, Zahl, klare These). KEINE Floskel.
- Danach 2-4 kurze Absätze mit konkretem Mehrwert oder Insight.
- Abschluss: dezente Einladung zum Lesen (Link wird automatisch angehängt, schreibe KEINEN Link).
- 3-5 relevante Hashtags am ENDE, durch Leerzeichen getrennt, deutsche oder fachliche Tags.

FACEBOOK-POST:
- Tonalität: lockerer als LinkedIn, aber seriös. Persoenlich, direkt.
- Max 800 Zeichen.
- 1-2 passende Emojis sind erlaubt (nicht am Satzanfang, sparsam).
- Klarer Mehrwert in 2-3 Saetzen, dann CTA (z.B. "Mehr im Blog", "Jetzt lesen", "Lies weiter").
- Link wird automatisch angehängt, schreibe KEINEN Link.
- Keine Hashtags noetig (max 1-2 wenn natürlich passend).

GOOGLE-BUSINESS-POST:
- So informativ wie der LinkedIn-Post, aber KEINE Hashtags und Sie-Ansprache.
- 600-1100 Zeichen: Hook, 2-3 Absätze konkreter Mehrwert aus dem Artikel, vollständige Sätze (NICHTS abschneiden).
- Letzter Satz ist ein klarer Call-to-Action, der zum "Mehr erfahren"-Button führt (z.B. "Lesen Sie im vollständigen Ratgeber, wie Sie konkret starten."). Der Button mit Link wird automatisch angehängt, schreibe KEINEN Link.

ANTWORTE GENAU SO (gültiges JSON, ohne Code-Fences):
{"linkedin":"...","facebook":"...","gbp":"..."}`
    : `Generate two social posts for this blog article.

ARTICLE TITLE: ${title}
PRIMARY KEYWORD: ${keyword}
ARTICLE EXCERPT: ${bodyText}

LINKEDIN POST:
- Audience: professionals, decision makers, industry context (${profile?.industry || ""}).
- Tone: professional, sharp, no buzzword bingo.
- Max 1300 characters.
- First 2 lines must hook (question, number, clear thesis). NO platitudes.
- Then 2-4 short paragraphs with concrete value or insight.
- Close with a soft invite to read (link auto-appended, do NOT include a URL).
- 3-5 relevant hashtags at the END separated by spaces.

FACEBOOK POST:
- Tone: lighter than LinkedIn but still serious. Personal, direct.
- Max 800 characters.
- 1-2 fitting emojis allowed (not at sentence start, sparingly).
- Clear value in 2-3 sentences, then CTA ("Read the full post", "More on the blog").
- Link auto-appended, do NOT include a URL.
- Hashtags optional (max 1-2 if naturally fitting).

GOOGLE BUSINESS POST:
- As informative as the LinkedIn post, but NO hashtags.
- 600-1100 characters: hook, 2-3 paragraphs of concrete value, complete sentences (never truncate).
- Final sentence is a clear call to action pointing at the "Learn more" button (button with link is auto-appended, do NOT include a URL).

REPLY EXACTLY LIKE THIS (valid JSON, no code fences):
{"linkedin":"...","facebook":"...","gbp":"..."}`;

  let raw;
  try {
    raw = await generateText(settings, systemPrompt, userPrompt);
  } catch (err) {
    return fallback(article, keyword, language, err);
  }

  raw = stripFences(raw);

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Versuche JSON im Text zu finden
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* leave null */ }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return fallback(article, keyword, language);
  }

  const linkedin = clip(String(parsed.linkedin || ""), 1300);
  const facebook = clip(String(parsed.facebook || ""), 800);
  const gbp = clip(String(parsed.gbp || ""), 1400);

  if (!linkedin || !facebook) {
    return fallback(article, keyword, language);
  }

  return { linkedin, facebook, gbp: gbp || null };
}

function fallback(article, keyword, language) {
  const title = article?.title || "";
  if (language === "en") {
    return {
      linkedin: clip(`${title}\n\nA new article on ${keyword}. Read the full breakdown on the blog.`, 1300),
      facebook: clip(`${title}\n\nNew on the blog: ${keyword}. Read more below.`, 800),
    };
  }
  return {
    linkedin: clip(`${title}\n\nNeuer Beitrag rund um ${keyword}. Den vollständigen Artikel gibt es im Blog.`, 1300),
    facebook: clip(`${title}\n\nNeu im Blog: ${keyword}. Jetzt weiterlesen.`, 800),
  };
}
