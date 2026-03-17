/**
 * Anti-Kitsch-Pass: Entfernt typische KI-Phrasen + Klischees aus dem HTML.
 * Kein Inhalts-Änderung, kein Längenänderung. Nur Formulierungen verbessern.
 */

import { generateText } from "../../providers/text.js";

const KITSCH_LIST = [
  "In der heutigen Zeit", "In einer Welt, in der", "In einer sich wandelnden Welt",
  "Es ist kein Geheimnis", "Nicht nur... sondern auch", "mehr als nur",
  "auf ganzer Linie", "Herzstück", "Mittelpunkt", "Dreh- und Angelpunkt",
  "perfekt aufeinander abgestimmt", "maßgeschneidert", "nahtlos",
  "unvergessliche Momente", "Momente einfangen", "Momente schaffen",
  "auf Augenhöhe", "Leidenschaft für", "mit Leidenschaft",
  "Ob... oder...", "ganzheitlich", "rundum", "aus einer Hand",
  "Dabei gilt", "Dabei ist", "Dabei sollte",
  "im Vordergrund steht", "steht im Mittelpunkt",
  "selbstverständlich", "natürlich auch", "versteht sich von selbst",
];

// Gedankenstriche (em-dash) aus Fließtext entfernen
const GEDANKENSTRICH_REGEX = /\s*—\s*/g;

/**
 * @param {object} settings - Tenant settings (für Modell-Auswahl)
 * @param {string} bodyHtml - HTML-Artikel nach dem Writer
 * @returns {string} Bereinigtes HTML
 */
export async function runAntiKitsch(settings, bodyHtml) {
  const systemPrompt = `Du bist Lektor. Deine einzige Aufgabe: Entferne typische KI-Phrasen aus dem HTML-Text.
KEINE inhaltlichen Änderungen. KEINE Längenänderungen. NUR Formulierungen verbessern.
Gib das bereinigte HTML zurück. Absolut nichts anderes.`;

  const userPrompt = `Bereinige diesen Blog-Text von KI-Klischees und typischen AI-Phrasen.

ENTFERNEN / UMFORMULIEREN (Beispiele):
${KITSCH_LIST.map(k => `- "${k}"`).join("\n")}

REGELN:
- Alle HTML-Tags, Links, <strong>, <details>, <table>, <figure> UNVERÄNDERT lassen
- Alle Fakten, Zahlen, Quellen beibehalten
- Gesamtlänge bleibt gleich (Ersatz-Formulierungen gleicher Länge wählen)
- Kein Markdown, nur HTML
- Klinge wie ein Fachexperte der schreibt, nicht wie eine KI

HTML:
${bodyHtml}`;

  try {
    let result = await generateText(settings, systemPrompt, userPrompt);
    // Strip code fences falls LLM sie hinzufügt
    result = result
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    // Gedankenstriche aus Text-Nodes entfernen (nicht in HTML-Attributen)
    result = result.replace(GEDANKENSTRICH_REGEX, ": ");
    return result || bodyHtml;
  } catch {
    return bodyHtml;
  }
}
