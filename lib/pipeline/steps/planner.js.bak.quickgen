/**
 * Step 1: THEMEN-PLANER
 * Wählt Kategorie × Angle × Saison mit Duplikat-Vermeidung.
 * Nutzt die tenant-spezifischen Angles aus der DB.
 */

import { query } from "../../db.js";

const DEFAULT_ANGLES = [
  { key: 1, label: "Zahlenfakt / Rechenbeispiel", active: true },
  { key: 2, label: "Kundenperspektive / Testimonial", active: true },
  { key: 3, label: "FAQ / Frage-Antwort", active: true },
  { key: 4, label: "Vergleich / Andere vs. Wir", active: true },
  { key: 5, label: "Tipp / Actionable Advice", active: true },
];

function getSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return { id: "spring", desc: "Frühling: Beste Zeit für Immobilienverkäufe, Markt zieht an" };
  if (month >= 6 && month <= 8) return { id: "summer", desc: "Sommer: Ideale Besichtigungsbedingungen, Außenbereich betonen" };
  if (month >= 9 && month <= 10) return { id: "autumn", desc: "Herbst: Käufer suchen vor Jahresende, letzte Chance" };
  return { id: "winter", desc: "Winter: Steuervorteile nutzen, weniger Konkurrenz am Markt" };
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

/**
 * @param {Array} topics - Tenant's configured topics (mit angles JSONB)
 * @param {string} language - Target language
 * @param {object} [override] - { categoryIndex, angleIndex } für manuelle Auswahl
 * @param {string} [tenantId] - Für Duplikat-Check
 * @returns {object} Plan
 */
export async function runPlanner(topics, language, override = null, tenantId = null) {
  const activeTopics = topics.filter((t) => t.is_active);
  if (activeTopics.length === 0) {
    throw new Error("No active topics configured for this tenant");
  }

  const season = getSeason();

  // Override: Manuelle Kategorie + Angle Auswahl
  if (override) {
    const catIdx = override.categoryIndex != null ? override.categoryIndex : Math.floor(Math.random() * activeTopics.length);
    const topic = activeTopics[catIdx % activeTopics.length];
    const angles = (topic.angles || DEFAULT_ANGLES).filter(a => a.active !== false);
    const angleIdx = override.angleIndex != null ? override.angleIndex : Math.floor(Math.random() * angles.length);
    const angle = angles[angleIdx % angles.length];

    return {
      category: topic.label,
      categoryLabel: topic.label,
      categoryDesc: topic.description,
      defaultCta: topic.default_cta,
      angle: angle.label,
      angleName: angle.label,
      angleDesc: `Blickwinkel: ${angle.label}`,
      season: season.id,
      seasonDesc: season.desc,
      language,
    };
  }

  // Automatik: Rotation mit Duplikat-Vermeidung
  let usedCombos = new Set();
  if (tenantId) {
    try {
      const { rows } = await query(
        `SELECT category, angle, season FROM ghostwriter_posts
         WHERE tenant_id = $1 AND is_test = false AND status != 'failed'`,
        [tenantId]
      );
      for (const r of rows) usedCombos.add(`${r.category}|${r.angle}|${r.season}`);
    } catch { /* table might not exist yet */ }
  }

  // Alle möglichen Kombinationen generieren
  const allCombos = [];
  for (const topic of activeTopics) {
    const angles = (topic.angles || DEFAULT_ANGLES).filter(a => a.active !== false);
    for (const angle of angles) {
      const key = `${topic.label}|${angle.label}|${season.id}`;
      allCombos.push({ topic, angle, key, used: usedCombos.has(key) });
    }
  }

  // Unbenutzte Kombinationen bevorzugen
  let available = allCombos.filter(c => !c.used);
  if (available.length === 0) {
    // Alle Kombis für diese Saison verbraucht → Reset (nochmal von vorne)
    available = allCombos;
  }

  // Rotation basierend auf day-of-year
  const doy = dayOfYear();
  const pick = available[doy % available.length];

  return {
    category: pick.topic.label,
    categoryLabel: pick.topic.label,
    categoryDesc: pick.topic.description,
    defaultCta: pick.topic.default_cta,
    angle: pick.angle.label,
    angleName: pick.angle.label,
    angleDesc: `Blickwinkel: ${pick.angle.label}`,
    season: season.id,
    seasonDesc: season.desc,
    language,
  };
}
