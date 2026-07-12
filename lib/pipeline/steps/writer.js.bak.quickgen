/**
 * Step 3: TEXTER
 * Generates the blog article + social teaser text
 * Supports structured research with source citations + animated stat widgets
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

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
 * @param {{ facts: string, sources: Array<{id,url,title}> }|string|null} research
 * @returns {object} { title, title_tag, meta_description, slug, body_html, gbp_text, social_text }
 */
export async function runWriter(settings, plan, seo, profile, language, research = null) {
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

  const wordRange = { short: "500–800", medium: "800–1200", long: "1200–1800", detailed: "1800–2500" }[settings.post_length || "medium"];
  const isRich = (settings.post_length === "long" || settings.post_length === "detailed");

  // Structured research: facts with numbered source references
  const { researchBlock, sourcesHtml } = buildResearchBlock(research);

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
- Füge <!-- IMAGE_2 --> an sinnvoller Stelle als Platzhalter für ein Foto ein
${isRich ? `- Füge eine FAQ-Sektion ein: <details><summary>Frage?</summary><p>Antwort</p></details> (3–5 Fragen)` : ""}

CONTENT-BAUSTEINE — wähle passend zum Angle (mind. 2 einsetzen):

1. CALLOUT-BOX — für Tipps, Hinweise, Warnungen:
<div class="callout callout--tip"><strong>Tipp:</strong> Text...</div>
<div class="callout callout--info"><strong>Wichtig:</strong> Text...</div>
<div class="callout callout--warning"><strong>Achtung:</strong> Text...</div>

2. STAT-GRID — für mehrere Kennzahlen nebeneinander (Angle "Zahlenfakt"):
<div class="stat-grid">
  <div class="stat-grid__item"><div class="stat-grid__num">3,5–6,5%</div><div class="stat-grid__label">Grunderwerbsteuer je Bundesland</div></div>
  <div class="stat-grid__item"><div class="stat-grid__num">2–6 Wo.</div><div class="stat-grid__label">Dauer Direktankauf</div></div>
</div>

3. COMPARE-BLOCK — für Vergleiche Andere vs. Wir (Angle "Vergleich"):
<div class="compare-block">
  <div class="compare-block__row compare-block__header"><div class="compare-block__crit">Kriterium</div><div>Alternative</div><div>Unsere Lösung</div></div>
  <div class="compare-block__row"><div class="compare-block__crit">Dauer</div><div class="compare-block__neg">3–12 Monate</div><div class="compare-block__pos">2–6 Wochen</div></div>
</div>
(mind. 5 Zeilen bei Vergleich-Angle)

4. PROCESS-STEPS — für Abläufe, Schritt-für-Schritt (Angle "Tipp"):
<ol class="process-steps"><li><strong>Schritt:</strong> Erklärung</li></ol>

5. CHECK- / CROSS-LISTE — für Vorteile/Nachteile:
<ul class="check-list"><li>Vorteil 1</li><li>Vorteil 2</li></ul>
<ul class="cross-list"><li>Nachteil 1</li></ul>

6. HIGHLIGHT-QUOTE — für einprägsame Kernaussagen:
<blockquote class="highlight-quote">Die wichtigste Aussage des Artikels in einem Satz.</blockquote>

7. VERGLEICHSTABELLE — für tabellarische Übersichten:
<table class="comparison-table"><thead><tr><th>Kriterium</th><th>Option A</th><th>Option B</th></tr></thead><tbody>...</tbody></table>

Angle-Empfehlung: "${plan.angleName}" → nutze bevorzugt:
${plan.angleName?.includes("Vergleich") ? "compare-block (Pflicht) + check-list + cross-list" : ""}${plan.angleName?.includes("Zahlenfakt") || plan.angleName?.includes("Rechenbeispiel") ? "stat-grid (Pflicht) + callout--info" : ""}${plan.angleName?.includes("FAQ") ? "details-Accordion (bereits vorgegeben) + callout--tip" : ""}${plan.angleName?.includes("Tipp") ? "process-steps (Pflicht) + callout--tip + check-list" : ""}${plan.angleName?.includes("Kundenperspektive") || plan.angleName?.includes("Testimonial") ? "highlight-quote + callout--info" : ""}
- Endet mit CTA-Block (PFLICHT, immer am Ende):
<div class="cta-block">
  <p class="cta-block__text">1–2 Sätze warum der Leser jetzt handeln soll (Nutzen, kein Druck).</p>
  <a href="${profile?.cta_url || profile?.website_url || '#'}" class="cta-block__btn" target="_blank" rel="noopener">Jetzt kostenlos anfragen →</a>
</div>
(Linktext passend zum Unternehmen anpassen, cta_url als href — Kontaktseite, nicht Startseite)
- Liefere auch: title_tag (max 60 Zeichen), meta_description (max 155 Zeichen), slug
- social_text: Google Business Profile Post, EXAKT 450–550 Zeichen. Struktur: Einstiegssatz (Problem/Nutzen), 2–3 kurze Absätze mit konkretem Mehrwert, Abschlusssatz mit Handlungsaufforderung + Link-Hinweis. Kein Hashtag, max 2 Emojis, natürliche Sprache. Zeichenzahl PFLICHT einhalten — weder kürzer noch länger.
${researchBlock ? `
QUELLENANGABEN & STAT-WIDGETS (PFLICHT wenn Recherche-Fakten vorhanden):
- Zahlen, Statistiken und Prozentwerte aus Recherche als animierten Stat-Widget einbetten:
  <span data-widget="stat" data-value="78" data-unit="%" data-label="kurze Beschreibung">78%</span>
  (data-value = reine Zahl, data-unit = Einheit wie % € m², data-label = 3–5 Wörter Kontext)
- Fakten aus der Recherche direkt nach der Aussage mit Quellen-Nummer zitieren:
  <a class="source-pill" href="#src-N">[N]</a>  (N = ID aus der QUELLEN-LISTE oben)
- Nur tatsächlich verwendete Quellen zitieren — keine erfundenen Nummern` : ""}

Antworte NUR im JSON-Format:
{
  "title": "...",
  "title_tag": "...",
  "meta_description": "...",
  "slug": "...",
  "body_html": "...",
  "primary_keyword": "...",
  "social_text": "...",
  "image_prompt_1": "English. Real documentary photo, NOT AI art. Format: [Nikon D850 OR Canon R5 + focal length], [overcast/window/warm afternoon light], [specific mundane real-world scene: describe textures, surfaces, objects for ${profile?.industry || "real estate"} in ${profile?.region || "Germany"}]. Grain visible. Slightly imperfect framing. NO faces, NO text, NO logos, NO symmetry, NO CGI glow. Max 150 chars.",
  "image_format_1": "landscape (default, wide scenes/exteriors) OR portrait (tall buildings/details/objects) — choose what fits the scene",
  "image_prompt_2": "English. Different angle from image_prompt_1. Same real-documentary rules: [camera], [natural light], [concrete detail: worn surface, material closeup, architectural fragment]. No symmetry, no staged look, no faces, no text. Max 150 chars.",
  "image_format_2": "landscape OR portrait — different orientation from image_format_1",
  "chart_config": null
}

DIAGRAMM-REGEL (chart_config):
- Setze chart_config NICHT auf null wenn der Artikel konkrete Zahlen/Statistiken/Vergleiche enthält
- Nutze Chart.js-Format: { "type": "bar"|"line"|"doughnut"|"horizontalBar", "data": { "labels": [...], "datasets": [{ "label": "...", "data": [...] }] }, "options": { "plugins": { "title": { "display": true, "text": "Diagramm-Titel" } } } }
- Beispiele wann sinnvoll: Preisvergleiche, Zeitreihen (Marktentwicklung), Bundesland-Vergleiche, Prozentanteile
- Beispiel: { "type": "bar", "data": { "labels": ["Bayern","NRW","Berlin"], "datasets": [{ "label": "Grunderwerbsteuer %", "data": [3.5, 6.5, 6.0] }] }, "options": { "plugins": { "title": { "display": true, "text": "Grunderwerbsteuer nach Bundesland" } } } }
- Nur 1 Chart pro Artikel, nur wenn wirklich passend — sonst null lassen`;

  const raw = await generateText(settings, systemPrompt, userPrompt);

  // Parse JSON from response — robust: handles unescaped HTML chars (href="...", newlines etc.)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Writer returned no valid JSON");
  let article;
  try {
    article = JSON.parse(jsonMatch[0]);
  } catch {
    // LLM erzeugt oft HTML mit unescapten " — jsonrepair korrigiert das automatisch
    article = JSON.parse(jsonrepair(jsonMatch[0]));
  }

  // Validate
  if (!article.title || !article.body_html) {
    throw new Error("Writer response missing title or body_html");
  }

  // social_text Fallback
  if (!article.social_text) {
    article.social_text = article.title;
  }
  if (article.social_text.length > 600) {
    article.social_text = article.social_text.slice(0, 597) + "...";
  }

  // gbp_text = social_text (Alias für Publisher-Kompatibilität)
  article.gbp_text = article.social_text;

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

  // Append sources section if research provided source links
  if (sourcesHtml) {
    article.body_html = article.body_html + sourcesHtml;
  }

  return article;
}

/**
 * Builds the research block for the writer prompt + the sources HTML section.
 * @param {{ facts: string, sources: Array<{id,url,title}> }|string|null} research
 * @returns {{ researchBlock: string, sourcesHtml: string }}
 */
function buildResearchBlock(research) {
  if (!research) return { researchBlock: "", sourcesHtml: "" };

  // Legacy: plain string
  if (typeof research === "string") {
    return {
      researchBlock: `\nRECHERCHE-FAKTEN (einbauen wo passend, NICHT erfinden):\n${research.slice(0, 2500)}\n`,
      sourcesHtml: "",
    };
  }

  const { facts, sources } = research;
  const sourcesList = sources.length > 0
    ? `\nQUELLEN-LISTE (für Inline-Zitierung):\n${sources.map(s => `[${s.id}] ${s.title} — ${s.url}`).join("\n")}`
    : "";

  const researchBlock = `\nRECHERCHE-FAKTEN (einbauen wo passend, NICHT erfinden):\n${facts.slice(0, 2500)}${sourcesList}\n`;

  // Build HTML sources section
  const sourcesHtml = sources.length > 0
    ? `\n<section class="sources-list" id="sources"><h2>Quellen</h2><ol>${
        sources.map(s =>
          `<li id="src-${s.id}"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`
        ).join("")
      }</ol></section>`
    : "";

  return { researchBlock, sourcesHtml };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
