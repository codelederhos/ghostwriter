/**
 * SEO Page Content Generator
 * Nutzt die gleiche generateText-Funktion und HTML-Bausteine wie der Blog-Writer,
 * aber mit einem Landing-Page-spezifischen Prompt (visuell, wenig Fließtext, viele Komponenten).
 */

import { generateText } from "../../providers/text.js";
import { jsonrepair } from "jsonrepair";

/**
 * Generiert KI-Content für eine SEO-Landingpage (Slug + Ort + Sprache).
 *
 * @param {object} settings - Decrypted tenant settings (text_provider, text_api_key, etc.)
 * @param {object} pageType - seo_page_types row (slug_template, category, ki_style_sample, title_template, etc.)
 * @param {object} location - seo_locations row (name, slug, state, lat, lng, local_spots, distance_km)
 * @param {string} lang - Sprachcode ('de', 'ro', 'en', etc.)
 * @param {object} profile - tenant_profiles row (company_name, industry, region, brand_voice, etc.)
 * @param {object} [existingPage] - Bestehende Seite (für Überarbeitung mit Diagnose-Kontext)
 * @param {object} [diagnostics] - Diagnose-Daten (keyword_gaps, suggestions)
 * @returns {object} { title, h1, meta_description, intro_html, local_html, practical_html, faq_json, schema_org, image_alts, internal_links, word_count }
 */
export async function generateSeoContent(settings, pageType, location, lang, profile, existingPage = null, diagnostics = null) {
  const locName = location.name?.[lang] || location.name?.de || "";
  const locSlug = location.slug?.[lang] || location.slug?.de || "";
  const localSpots = location.local_spots?.[lang] || location.local_spots?.de || [];
  const distanceKm = location.distance_km || "";
  const serviceLabel = (pageType.slug_template || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const LANG_NAMES = { de: "Deutsch", en: "English", ro: "Română", fr: "Français", es: "Español", it: "Italiano", ru: "Русский" };
  const langName = LANG_NAMES[lang] || lang;

  const systemPrompt = `Du bist Content-Stratege für ${profile?.company_name || "ein Unternehmen"}.
Du erstellst SEO-Landing-Pages die VISUELL und SCANNBAR sind — keine Textwüsten.
Jeder Block muss ein eigenständiges visuelles Element sein.`;

  // Diagnose-Kontext für Überarbeitung
  let diagBlock = "";
  if (diagnostics) {
    const gaps = diagnostics.keyword_gaps?.map(k => k.query).join(", ") || "";
    diagBlock = `
DIAGNOSE (bestehende Seite überarbeiten):
${diagnostics.flag_not_indexed ? "- Seite ist NICHT indexiert → Content zu dünn, mehr unique Wörter nötig\n" : ""}${diagnostics.flag_ctr_low ? "- CTR zu niedrig → Title + Meta Description müssen packender werden\n" : ""}${diagnostics.flag_keyword_gap ? `- Keyword-Lücken: ${gaps} → diese Begriffe natürlich einbauen\n` : ""}${diagnostics.flag_bounce_high ? "- Hohe Absprungrate → Intro packt nicht, visueller gestalten\n" : ""}${diagnostics.flag_near_page1 ? "- Position 11-20 → gezielte Optimierung für Page-1-Sprung\n" : ""}
BESTEHENDER CONTENT (überarbeiten, nicht komplett neu):
Title: ${existingPage?.title || "—"}
H1: ${existingPage?.h1 || "—"}
`;
  }

  const userPrompt = `FIRMENPROFIL:
${JSON.stringify({
  company: profile?.company_name,
  industry: profile?.industry,
  region: profile?.region,
  usp: profile?.usp,
  positioning: profile?.positioning,
  services: profile?.services,
  brand_voice: profile?.brand_voice,
  website: profile?.website_url,
  cta_url: profile?.cta_url,
}, null, 2)}

SEITE: ${serviceLabel} in ${locName}
SPRACHE: ${langName}
BUNDESLAND: ${location.state || "Bayern"}
DISTANZ: ${distanceKm ? `${distanceKm} km vom Firmenstandort` : "Nahbereich"}
LOKALE SPOTS: ${localSpots.length > 0 ? localSpots.join(", ") : "Keine bekannt"}
STYLE-SAMPLE: ${pageType.ki_style_sample || "Warm, direkt, wie die Person selbst schreibt. Kein Marketingdeutsch."}
SCHEMA-TYP: ${pageType.schema_type || "LocalBusiness"}
${diagBlock}

AUFGABE: Erstelle eine Landing Page mit ~${pageType.min_words || 700} Wörtern.
WICHTIG: KEINE TEXTWÜSTE. Jeder Block ist ein eigenständiges VISUELLES Element.

PFLICHT-BAUSTEINE (alle nutzen, in dieser Reihenfolge):

1. intro_html (~200 Wörter) — Persönliche, orts-spezifische Einleitung. NICHT nur Text:
   - Starte mit 1-2 Sätzen, dann sofort ein visuelles Element
   - Nutze stat-grid für Zahlen (z.B. Erfahrung, Projekte, Bewertungen):
     <div class="stat-grid">
       <div class="stat-grid__item"><div class="stat-grid__num">500+</div><div class="stat-grid__label">Shootings in Bayern</div></div>
     </div>
   - Oder highlight-quote für eine starke Aussage:
     <blockquote class="highlight-quote">Kernaussage die im Kopf bleibt.</blockquote>
   - Dann check-list für Vorteile:
     <ul class="check-list"><li>Vorteil 1</li><li>Vorteil 2</li></ul>

2. local_html (~200 Wörter) — Lokaler Kontext mit ${locName}. VISUELL aufbereiten:
   - Konkrete Spots/Locations als Karten oder compare-block (nicht Fließtext):
     <div class="compare-block">
       <div class="compare-block__row compare-block__header"><div class="compare-block__crit">Location</div><div>Vorteil</div><div>Ideal für</div></div>
       <div class="compare-block__row"><div class="compare-block__crit">${localSpots[0] || "Altstadt"}</div><div class="compare-block__pos">Historische Kulisse</div><div>Outdoor</div></div>
     </div>
   - Oder process-steps für Anfahrt/Ablauf:
     <ol class="process-steps"><li><strong>Anfahrt:</strong> Beschreibung</li></ol>
   - Callout für wichtige Hinweise:
     <div class="callout callout--info"><strong>Gut zu wissen:</strong> Text...</div>

3. practical_html (~150 Wörter) — Praktisches, NICHT als Absätze sondern als:
   - process-steps (nummerierte Schritte: Ablauf, Buchung, etc.)
   - stat-grid (Dauer, Preisrange, etc.)
   - compare-block (Studio vs Outdoor, Paket-Vergleich, etc.)
   - Mindestens 2 verschiedene Bausteine nutzen!

4. faq_json — Array mit 4-6 orts-spezifischen FAQs:
   [{"q": "Frage mit ${locName}?", "a": "Antwort (2-3 Sätze, konkret)"}]
   - Fragen müssen ${locName}-spezifisch sein (nicht nur Stadtname austauschen!)
   - Mindestens 1 Frage zu lokalen Gegebenheiten

5. CTA am Ende von intro_html UND practical_html (PFLICHT):
   <div class="cta-block">
     <p class="cta-block__text">1-2 Sätze Nutzen.</p>
     <a href="${profile?.cta_url || profile?.website_url || '/kontakt/'}" class="cta-block__btn" target="_blank" rel="noopener">Jetzt anfragen →</a>
   </div>

VERBOTEN:
- Lange Fließtext-Absätze (max 3 Sätze am Stück, dann visuelles Element)
- Generische Phrasen die für jede Stadt gelten
- Doppelte Infos zwischen den Blöcken
- Leere Worthülsen, Marketingdeutsch, Floskeln

Antworte NUR als JSON:
{
  "title": "max 60 Zeichen, mit ${locName}",
  "h1": "Hauptüberschrift mit ${locName}",
  "meta_description": "max 155 Zeichen, mit ${locName}, packend",
  "intro_html": "HTML mit Bausteinen",
  "local_html": "HTML mit Bausteinen",
  "practical_html": "HTML mit Bausteinen",
  "faq_json": [{"q":"...","a":"..."}],
  "image_alts": {"hero": "Beschreibung mit ${locName}"},
  "internal_links": [
    {"label": "Hauptseite", "slug": "${pageType.slug_template}", "type": "parent"},
    {"label": "Nahegelegener Ort", "slug": "${pageType.slug_template}-ORTNAME", "type": "nearby"}
  ]
}`;

  const raw = await generateText(settings, systemPrompt, userPrompt);

  // Parse JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("SEO Writer returned no valid JSON");

  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch {
    result = JSON.parse(jsonrepair(jsonMatch[0]));
  }

  if (!result.intro_html) throw new Error("SEO Writer missing intro_html");

  // Word count
  const allHtml = [result.intro_html, result.local_html, result.practical_html].filter(Boolean).join(" ");
  const wordCount = allHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  result.word_count = wordCount;

  // Enforce title length
  if (result.title?.length > 60) result.title = result.title.slice(0, 57) + "...";
  if (result.meta_description?.length > 155) result.meta_description = result.meta_description.slice(0, 152) + "...";

  // Schema.org generieren
  result.schema_org = {
    "@context": "https://schema.org",
    "@type": [pageType.schema_type || "LocalBusiness", "Service"],
    "name": profile?.company_name,
    "serviceArea": { "@type": "City", "name": locName },
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": serviceLabel,
      "itemListElement": [{ "@type": "Offer", "name": `${serviceLabel} in ${locName}` }],
    },
    "mainEntity": {
      "@type": "FAQPage",
      "mainEntity": (result.faq_json || []).map(faq => ({
        "@type": "Question",
        "name": faq.q,
        "acceptedAnswer": { "@type": "Answer", "text": faq.a },
      })),
    },
  };

  return result;
}
