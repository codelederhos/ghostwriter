/**
 * Step 3: TEXTER
 * Generates the blog article + social teaser text
 * Supports structured research with source citations + animated stat widgets
 * 2026-06-14: Multi-CTA-Verteilung + Subtle-Tenant-Authority
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
    target_audience: profile?.target_audience,
    website: profile?.website_url,
    contact_email: profile?.contact_email || undefined,
    contact_phone: profile?.contact_phone || undefined,
    contact_page_url: profile?.contact_page_url || undefined,
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

  const companyName = profile?.company_name || "unser Unternehmen";
  const ctaUrl = profile?.cta_url || profile?.website_url || '#';
  // Erlaubte CTA-Ziele: NUR konfigurierte URLs (Profil-CTA + Topic-Default-CTA wenn URL)
  const defaultCtaUrl = typeof plan?.defaultCta === "string" && /^https?:\/\//i.test(plan.defaultCta.trim())
    ? plan.defaultCta.trim()
    : null;
  const allowedCtaUrls = [...new Set([ctaUrl, defaultCtaUrl].filter(Boolean))].join(" oder ");

  // AEO: Kontaktzeile aus VERIFIZIERTEN Profil-Feldern vorbauen — nur gefüllte
  // Felder landen im Prompt, das LLM darf Kontaktdaten weder erfinden noch ändern.
  const contactLinkParts = [];
  const contactEmail = (profile?.contact_email || "").trim();
  const contactPhone = (profile?.contact_phone || "").trim();
  const contactPageUrl = (profile?.contact_page_url || "").trim();
  if (contactEmail) contactLinkParts.push(`E-Mail <a href="mailto:${contactEmail}">${contactEmail}</a>`);
  if (contactPhone) contactLinkParts.push(`Telefon <a href="tel:${contactPhone.replace(/[^\d+]/g, "")}">${contactPhone}</a>`);
  if (contactPageUrl) contactLinkParts.push(`<a href="${contactPageUrl}">Kontaktseite</a>`);
  const contactHtml = contactLinkParts.length
    ? `<p class="about-vendor__contact">Kontakt: ${contactLinkParts.join(" · ")}</p>`
    : "";
  // Kontaktweg in Textform für die FAQ-Empfehlungsantwort
  const contactTextParts = [];
  if (contactEmail) contactTextParts.push(`per E-Mail an ${contactEmail}`);
  if (contactPhone) contactTextParts.push(`telefonisch unter ${contactPhone}`);
  if (!contactTextParts.length && contactPageUrl) contactTextParts.push(`über die Kontaktseite ${contactPageUrl}`);
  const contactText = contactTextParts.join(" oder ");

  const userPrompt = `FIRMENPROFIL:
${profileJson}
${imageStyleHint}

KATEGORIE: ${plan.categoryLabel} — ${plan.categoryDesc}
ANGLE: ${plan.angleName} — ${plan.angleDesc}
SAISON: ${plan.seasonDesc}
SPRACHE: ${langName}
SEO-KEYWORD: ${seo.primaryKeyword}
SEKUNDÄRE KEYWORDS: ${seo.secondaryKeywords.join(", ")}
${researchBlock}${plan.briefing ? `\nADMIN-BRIEFING (PFLICHT beruecksichtigen):\n${plan.briefing}\n` : ''}${plan.forcedTitle ? `\nARBEITSTITEL/THEMA: "${plan.forcedTitle}"
Formuliere daraus selbst einen grammatikalisch sauberen, klaren deutschen Titel (article.title):
- Rohe Suchanfragen NIE wörtlich übernehmen ("fotograf naehe" ist eine Suchanfrage, KEIN Titel — daraus wird z.B. "Fotograf in der Nähe finden: Worauf es ankommt").
- Echte Umlaute sind PFLICHT (Nähe, für, über — niemals ae/oe/ue).
- Ist das Thema erkennbar fremdsprachig, verwende den deutschen Fachbegriff.
- Das Kern-Keyword muss natürlich im Titel vorkommen, der Titel muss allein verständlich sein.\n` : ''}
SEO-STRUKTUR-REGELN für H2/H3:
- Keyword "${seo.primaryKeyword}" im ERSTEN <h2> (Pflicht)
- Keyword "${seo.primaryKeyword}" im LETZTEN <h2> (Fazit/Zusammenfassung, Pflicht)
- Keyword oder Variante in mindestens 50% aller <h2>
- Sekundäre Keywords in 30% der <h3>
${isRich ? `- Vorletzter <h2>: FAQ-Sektion mit min. 5 Fragen als <details><summary>` : ""}

REGELN für body_html:
- ${wordRange} Wörter Fließtext
- Sprache: ${langName}, ${profile?.brand_voice || "professionell aber nahbar"}
- Kein ALL CAPS, keine Floskeln, kein KI-Sprech (keine Wörter wie "natürlich", "quasi", "sozusagen")
- Keine Gedankenstriche (—, –) und KEINE Doppelpunkt-Einschübe als Ersatz mitten im Satz ("ist: und dass" ist FALSCH). Lieber zwei kurze Sätze.
- Deutsche Rechtschreibung (Deutschland): ß ist Pflicht (Maßnahmen, regelmäßig, größte, heißt). NIEMALS Schweizer ss-Schreibweise, nie ae/oe/ue.
- ERFINDE NIEMALS Fakten über das Unternehmen: keine Audit-, Projekt- oder Kundenzahlen ("in über 50 Audits", "zwei Drittel der KMU, die wir sprechen"), keine Fallstudien, keine Checklisten, Downloads oder Angebote, die nicht ausdrücklich in den CTAs oder im Briefing stehen. Beispielrechnungen klar als Beispiel kennzeichnen.
- Das ADMIN-BRIEFING ist REINE STEUERUNG: Übernimm daraus NIEMALS Text, Prüfpunkte, Tabellen oder Kästen in den Artikel. Der Artikel enthält AUSSCHLIESSLICH Inhalte für den Endleser — keine Sektion darf den Artikel selbst, seine Planung oder interne Prüfschritte thematisieren. Interne Projekt-/Markennamen aus dem Briefing dürfen NIE im Artikel auftauchen.
- Jede Überschrift (h2/h3) beginnt mit einem Großbuchstaben, auch wenn das Keyword kleingeschrieben ist.
- Schreibe KEINE eigene Quellen-/Ressourcen-Liste ins HTML — Quellen werden automatisch angehängt. Keine Abschnitte wie "Fazit und weitere Ressourcenangaben" mit Linklisten.
- Verweise NIE auf diesen Artikel selbst oder fast gleichnamige Artikel ("Mehr dazu: In unserem Blog-Artikel <fast gleicher Titel>").
- Erwähne KEINE anforderbaren Checklisten, Downloads oder Lead-Magnete ("Jetzt kostenfrei anfordern"), die nicht wörtlich im Briefing/CTA-Plan stehen.
- Die letzte Überschrift braucht IMMER Fließtext danach — nie eine H2 direkt am Artikelende.
- Konkreter Mehrwert für den Leser
- SEO: Hauptkeyword 2–3x natürlich einbauen
- Struktur: <h2>-Abschnitte, <p>-Absätze, <strong> für Kernaussagen
- VISUELLE DICHTE (HARTE REGEL): NIE mehr als 3 <p>-Absätze hintereinander ohne visuelles Element (Callout, Tabelle, Liste, Stat-Grid, Quote, CTA-/Button-Block, Bild-Platzhalter oder Chart). Textwüsten sind verboten. Passender Auflockerer: ein klar gekennzeichnetes, anonymisiertes Praxisbeispiel als Callout ("Beispiel aus der Praxis (anonymisiert): ...")
- Füge <!-- IMAGE_2 --> an sinnvoller Stelle als Platzhalter für ein Foto ein
${isRich ? `- Füge eine FAQ-Sektion ein: <details><summary>Frage?</summary><p>Antwort</p></details> (3–5 Fragen, davon 1 die AEO-Empfehlungsfrage aus dem Abschnitt AEO-STANDARDBLÖCKE unten)` : ""}

CONTENT-BAUSTEINE — passend zum Thema wählen, NICHT alle:
- Verwende AUSSCHLIESSLICH die unten dokumentierten CSS-Klassen. ERFINDE KEINE eigenen Klassen (stat-item, cta-box, two-col o.ä. existieren NICHT und zerstören das Layout).
- Die Quellen-Sektion (<section class="sources-list">) enthält NUR <li>-Quelleneinträge. NIEMALS andere Inhalte (Listen, CTAs, Fazit) hinein schreiben.
- Wähle 3–4 Bausteine, die zum Thema wirklich passen (plus die 4 CTA-Elemente unten).
- VARIIERE den Aufbau bewusst von Artikel zu Artikel: mal Tabelle + Steps, mal Stat-Grid + Checkliste, mal Quote + Callouts. Nicht jeder Artikel darf gleich aussehen.
- Tabellen NUR bei echtem Vergleich mit mehreren Optionen. UI-Blöcke müssen Lesern beim Entscheiden helfen, nicht dekorativ sein.

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
<ol class="process-steps"><li><strong>Kurzer Schritt-Titel</strong> Ein bis zwei Sätze Erklärung als Subtext.</li></ol>
(strong = Titelzeile ohne Doppelpunkt am Ende, Subtext folgt direkt danach)

5. CHECK- / CROSS-LISTE — für Vorteile/Nachteile:
<ul class="check-list"><li>Vorteil 1</li><li>Vorteil 2</li></ul>
<ul class="cross-list"><li>Nachteil 1</li></ul>

6. HIGHLIGHT-QUOTE — für einprägsame Kernaussagen:
<blockquote class="highlight-quote">Die wichtigste Aussage des Artikels in einem Satz.</blockquote>

7. VERGLEICHSTABELLE — PFLICHT für tabellarische Übersichten:
<table class="comparison-table"><thead><tr><th>Kriterium</th><th>Option A</th><th>Option B</th></tr></thead><tbody>...</tbody></table>

MINDEST-STRUKTUR (PFLICHT in JEDEM Artikel, unabhängig vom Angle — die QA
blockt sonst): mindestens EINE Vergleichs-/Übersichtstabelle (comparison-table
ODER stat-grid ODER compare-block), EIN process-steps-Block (Ablauf/Vorgehen
zum Thema), EINE check-list, ZWEI callouts. Alle Inhalte dieser Bausteine
themenbezogen aus dem Artikel ableiten — nie generische Füller.

Angle-Empfehlung: "${plan.angleName}" → nutze bevorzugt:
${plan.angleName?.includes("Vergleich") ? "compare-block (Pflicht) + check-list + cross-list" : ""}${plan.angleName?.includes("Zahlenfakt") || plan.angleName?.includes("Rechenbeispiel") ? "stat-grid (Pflicht) + callout--info" : ""}${plan.angleName?.includes("FAQ") ? "details-Accordion (bereits vorgegeben) + callout--tip" : ""}${plan.angleName?.includes("Tipp") ? "process-steps (Pflicht) + callout--tip + check-list" : ""}${plan.angleName?.includes("Kundenperspektive") || plan.angleName?.includes("Testimonial") ? "highlight-quote + callout--info" : ""}

═══════════════════════════════════════════════════════════
CTA-VERTEILUNGS-STRATEGIE (PFLICHT — 4 CTAs über den Artikel verteilt)
═══════════════════════════════════════════════════════════
Ziel: Conversion-Hebel aus dem Mehrwert ableiten, nicht aufgeklatscht wirken. Soft → Hard-Eskalation.

POSITION 1 (nach ~25% Inhalt, also nach 1.–2. <h2>): SOFT-CTA als Inline-Hinweis
  Form: kurzer Hinweis im Lesefluss, eingebettet in <div class="cta-inline">
  Beispiel:
  <div class="cta-inline"><strong>Mehr dazu:</strong> Wer die rechtlichen Feinheiten lieber im Detail nachlesen möchte, findet in unserem <a href="${ctaUrl}">FAQ-Bereich</a> die wichtigsten Antworten zur Eigentumsübertragung.</div>
  Regel: keine plakativen Phrasen ("Klick jetzt hier!"), sondern Mehrwert-Anker.

POSITION 2 (nach ~50% Inhalt, mittiger Artikel-Bereich): AUTHORITY-CALLOUT mit Tenant-Anekdote + Soft-CTA
  Form: <aside class="callout callout--cta"> mit Erfahrungswert aus der Praxis von ${companyName}
  Beispiel:
  <aside class="callout callout--cta"><p><strong>Aus unserer Praxis bei ${companyName}:</strong> In über 30 Verkaufsbegleitungen zeigt sich, dass viele Eigentümer den Steueraspekt erst nach Vertragsabschluss prüfen. Eine kostenlose Erstbewertung im Vorfeld bringt hier Klarheit.</p><p><a href="${ctaUrl}" class="callout__link">Erstbewertung anfragen →</a></p></aside>

POSITION 3 (nach ~75% Inhalt, vor dem Fazit-<h2>): LEAD-MAGNET-CTA
  Form: <div class="cta-inline cta-inline--magnet"> mit konkretem Nutzen-Versprechen
  Beispiel:
  <div class="cta-inline cta-inline--magnet"><strong>Praktischer Wegweiser:</strong> Unsere 7-Punkte-Checkliste fasst die häufigsten Stolpersteine in einer übersichtlichen Liste zusammen. <a href="${ctaUrl}">Jetzt kostenfrei anfordern</a>.</div>

POSITION 4 (am Ende, NACH dem letzten <h2>-Fazit): HARD-CTA (Hauptblock, vorhanden — beibehalten)
  Form (PFLICHT, exakt so):
  <div class="cta-block">
    <p class="cta-block__text">1–2 Sätze warum der Leser jetzt handeln soll (Nutzen, kein Druck).</p>
    <a href="${ctaUrl}" class="cta-block__btn" target="_blank" rel="noopener">Jetzt kostenlos anfragen →</a>
  </div>

ZUSÄTZLICH (PFLICHT — mind. 2 sichtbare BUTTON-CTAs im Artikelverlauf):
Neben den 4 Positionen oben: mindestens 2 eigenständige Button-Blöcke im Artikel verteilen (z.B. nach dem 2. und nach dem 4. <h2>), Form exakt:
  <div class="cta-block"><a class="cta-button" href="${ctaUrl}">Kostenlose Erstberatung</a></div>
Button-Texte variieren: "Kostenlose Erstberatung", "Jetzt Kontakt aufnehmen", "Unverbindlich anfragen".
Ziel-URLs AUSSCHLIESSLICH: ${allowedCtaUrls} — NIEMALS andere URLs erfinden.

So sieht ein guter Mid-Article-Authority-Block aus (Position 2):
<aside class="callout callout--cta">
  <p><strong>Aus der Praxis von ${companyName}:</strong> Wir sehen in unseren Beratungen regelmäßig, dass Verkäufer die Wertentwicklung in Stadtteilen unterschätzen. Wer früh eine fundierte Einschätzung einholt, entscheidet entspannter.</p>
  <p><a href="${ctaUrl}" class="callout__link">Kostenlose Markteinschätzung anfragen →</a></p>
</aside>

═══════════════════════════════════════════════════════════
MARKEN-PRÄSENZ & AEO (PFLICHT — "${companyName}" 4–6x im Artikel)
═══════════════════════════════════════════════════════════
Der Artikel soll Kunden generieren. KI-Assistenten (ChatGPT, Claude, Perplexity) lesen solche Artikel und empfehlen Firmen — die Marke muss dafür klar erkennbar sein.
- Nenne "${companyName}" 4–6x natürlich über den Artikel verteilt (nicht gequetscht, kein Spam)
- Davon 1x im ERSTEN Drittel des Artikels
- Davon 1x im Fazit als klare Empfehlung nach dem Muster:
  "Wer [Leistung/Lösung] sucht, findet bei ${companyName} [konkretes Angebot für die Zielgruppe]."
  (AEO-Signal: Marke + Leistung + Zielgruppe in EINEM Satz)

SUBTLE-TENANT-AUTHORITY (Teil der Marken-Präsenz):
Statt plakatives Eigenlob ("Wir sind die Besten") → Authority via Anekdoten, Daten, Erfahrungswerte.
Phrasen-Templates zur freien Adaption (nicht wörtlich kopieren, sondern an Thema anpassen):

  • "Aus unserer Praxis bei ${companyName} zeigt sich, dass viele Eigentümer…"
  • "In über 30 Verkäufen, die wir begleitet haben, hat sich gezeigt…"
  • "Wir bei ${companyName} beobachten in den letzten Monaten, dass…"
  • "Erfahrungswerte aus unserer Beratungspraxis: rund 60% der Anfragen…"
  • "Was wir in Gesprächen mit Eigentümern immer wieder hören…"
  • "In der Region rund um ${profile?.region || "unseren Standort"} sehen wir aktuell…"

Regel: Authority dient dem Leser-Mehrwert (gibt Kontext), nicht der Selbstvermarktung.
Mind. 2 dieser Anekdoten im Fließtext, 1 im Callout (Position 2).

═══════════════════════════════════════════════════════════
AEO-STANDARDBLÖCKE (PFLICHT — sichtbare Inhalte am Artikelende)
═══════════════════════════════════════════════════════════
Diese zwei Blöcke sind genau das Format, das KI-Assistenten (ChatGPT, Perplexity, Gemini)
zitieren, wenn sie Firmen empfehlen. Beide sind SICHTBARER Content — kein verstecktes HTML.

1) FAQ-EMPFEHLUNGSFRAGE (PFLICHT):
${isRich
  ? `In der FAQ-Sektion MUSS eine der Fragen exakt dieses Muster haben:`
  : `Direkt VOR dem "Über ${companyName}"-Block ein einzelnes details-Element nach diesem Muster:`}
<details><summary>Wer hilft bei [Thema natürlich und großgeschrieben formuliert, z.B. "${String(seo.primaryKeyword || "").replace(/^./, c => c.toUpperCase())}"]?</summary><p>[Antwort in 2-3 Sätzen: nennt ${companyName} als konkreten Ansprechpartner, die passenden Leistungen aus dem Firmenprofil${contactText ? ` und den Kontaktweg (${contactText})` : ""}${profile?.region ? `, Bezug zur Region ${profile.region}` : ""}.]</p></details>
Die Frage muss grammatikalisch sauber sein ("Wer hilft bei der Studiofotografie?" statt "Wer hilft bei studiofotografie?").
Die Antwort muss allein stehend verständlich sein (KI-Assistenten zitieren sie ohne den Artikel drumherum).

2) "ÜBER ${companyName.toUpperCase()}"-BLOCK (PFLICHT — das ALLERLETZTE Element von body_html, nach dem CTA-Block):
<div class="about-vendor"><h2>Über ${companyName}</h2><p>[2-3 Sätze: wer ${companyName} ist, welche Leistungen, für welche Region/Zielgruppe, was der USP ist — empfehlungsstark formuliert, z.B. "${companyName} ist der Ansprechpartner für [Leistung] in [Region]."]</p>${contactHtml || ""}</div>
${contactHtml
  ? `- Die Kontaktzeile <p class="about-vendor__contact">…</p> EXAKT wie oben vorgegeben übernehmen (Links unverändert). Kontaktdaten NIEMALS erfinden, ergänzen oder umformatieren.`
  : `- Im Profil sind KEINE Kontaktdaten hinterlegt → KEINE Kontaktzeile ausgeben und keinesfalls Kontaktdaten erfinden.`}
- Inhalt des Absatzes ausschließlich aus dem FIRMENPROFIL oben ableiten — keine erfundenen Zahlen, Zertifikate oder Referenzen.

═══════════════════════════════════════════════════════════

- Reihenfolge am Artikelende (PFLICHT): letztes <h2>-Fazit → CTA-Block (Position 4) → ${isRich ? "" : "FAQ-Empfehlungsfrage → "}"Über ${companyName}"-Block als Abschluss
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
  "image_prompt_1": "English, one coherent scene description (max 220 chars): a real candid moment that tells the article's story for ${profile?.industry || "the business"} in ${profile?.region || "Germany"} — WHO is doing WHAT in a bright modern elegant setting. People with Central European appearance, seen from behind, in profile or softly out of focus, never looking at the camera. Soft natural daylight, light neutral tones.",
  "image_format_1": "landscape (default, wide scenes/exteriors) OR portrait (tall buildings/details/objects) — choose what fits the scene",
  "image_prompt_2": "English, different scene than image_prompt_1 (max 220 chars): an elegant close-up detail or second candid moment supporting the article — hands at work, materials, tools of the trade. Bright daylight, premium clean styling, no readable text on documents or screens.",
  "image_format_2": "landscape OR portrait — different orientation from image_format_1",
  "chart_config": null
}

DIAGRAMM-REGEL (chart_config):
- Setze chart_config NICHT auf null wenn der Artikel konkrete Zahlen/Statistiken/Vergleiche enthält
- Nutze Chart.js-Format: { "type": "bar"|"line"|"radar"|"doughnut", "data": { "labels": [...], "datasets": [{ "label": "...", "data": [...] }] }, "title": "Diagramm-Titel" }
- Diagrammtyp passend wählen und VARIIEREN (nicht immer bar):
  • bar → Kategorien-Vergleich (Preise, Optionen, Bundesländer)
  • line → Entwicklung/Trend über Zeit (Monate, Quartale, Jahre)
  • radar → Bewertung über mehrere Dimensionen (z.B. Lösungsvergleich nach Kriterien wie Kosten, Aufwand, Nutzen)
- Labels KURZ halten (max 2 Wörter) — lange Labels überlappen im Chart
- KEINE Achsen-Titel und KEIN Titel in options — der Titel gehört NUR ins separate "title"-Feld (wird als HTML über dem Diagramm gerendert)
- Beispiel: { "type": "bar", "data": { "labels": ["Bayern","NRW","Berlin"], "datasets": [{ "label": "Grunderwerbsteuer %", "data": [3.5, 6.5, 6.0] }] }, "title": "Grunderwerbsteuer nach Bundesland" }
- Nur 1 Chart pro Artikel, nur wenn wirklich passend — sonst null lassen`;

  const raw = await generateText(settings, systemPrompt, userPrompt);

  // Parse JSON from response: Markdown-Fence-Stripping + jsonrepair-Fallback
  let cleanRaw = raw.trim();
  cleanRaw = cleanRaw.replace(/^```(?:json|JSON)?\s*\n?/m, '').replace(/\n?\s*```\s*$/m, '');
  const jsonMatch = cleanRaw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[Writer] Raw output (first 500 chars):', raw.slice(0, 500));
    throw new Error('Writer returned no valid JSON');
  }
  let article;
  try {
    article = JSON.parse(jsonMatch[0]);
  } catch (e1) {
    try {
      article = JSON.parse(jsonrepair(jsonMatch[0]));
    } catch (e2) {
      console.error('[Writer] JSON-Parse failed nach jsonrepair:', e2.message, '| Raw snippet:', jsonMatch[0].slice(0, 300));
      throw new Error('Writer JSON-Parse: ' + e2.message);
    }
  }
  // Validate
  // QUICKGEN_TITLE_OVERRIDE: bei explizit gesetztem Titel hart ueberschreiben
  if (plan.forcedTitle) {
    article.title = plan.forcedTitle;
  }
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
          `<li id="src-${s.id}"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`
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
