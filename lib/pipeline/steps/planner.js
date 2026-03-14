/**
 * Step 1: THEMEN-PLANER
 * Berechnet Kategorie + Angle + Saison basierend auf Rotationsformel
 */

const ANGLES = [
  { id: "A", name: "Zahlenfakt", desc: "Konkretes Rechenbeispiel, Euro-Betrag, Statistik" },
  { id: "B", name: "Kundenperspektive", desc: "Testimonial-Stil, 'Stellen Sie sich vor...', Erfolgsstory" },
  { id: "C", name: "FAQ", desc: "Frage-Antwort-Format, häufige Einwände entkräften" },
  { id: "D", name: "Vergleich", desc: "'Andere vs. Wir', Differenzierung zur Konkurrenz" },
  { id: "E", name: "Tipp", desc: "Actionable Advice, konkreter Mehrwert für Leser" },
];

function getSeason() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return { id: "spring", desc: "Frühling: Beste Zeit für Immobilienverkäufe, Markt zieht an" };
  if (month >= 6 && month <= 8) return { id: "summer", desc: "Sommer: Ideale Besichtigungsbedingungen, Außenbereich betonen" };
  if (month >= 9 && month <= 10) return { id: "autumn", desc: "Herbst: Käufer suchen vor Jahresende, letzte Chance" };
  return { id: "winter", desc: "Winter: Steuervorteile nutzen, weniger Konkurrenz am Markt" };
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / 86400000);
}

/**
 * @param {Array} topics - Tenant's configured topics
 * @param {string} language - Target language
 * @returns {object} { category, categoryLabel, categoryDesc, angle, angleDesc, season, seasonDesc, language }
 */
export function runPlanner(topics, language) {
  const doy = dayOfYear();
  const activeTopics = topics.filter((t) => t.is_active);

  if (activeTopics.length === 0) {
    throw new Error("No active topics configured for this tenant");
  }

  const categoryIndex = doy % activeTopics.length;
  const angleIndex = Math.floor(doy / activeTopics.length) % ANGLES.length;
  const season = getSeason();
  const topic = activeTopics[categoryIndex];
  const angle = ANGLES[angleIndex];

  return {
    category: topic.label,
    categoryLabel: topic.label,
    categoryDesc: topic.description,
    defaultCta: topic.default_cta,
    angle: angle.id,
    angleName: angle.name,
    angleDesc: angle.desc,
    season: season.id,
    seasonDesc: season.desc,
    language,
  };
}
