function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasClass(body, cls) {
  return new RegExp(`class=["'][^"']*${cls}`, "i").test(body || "");
}

function insertBeforeFinalH2(body, html) {
  const value = String(body || "");
  // Quellen-Section + AEO-About-Block gehören ans Ende — deren <h2> ist nicht das Fazit
  const sourcesIdx = value.indexOf('<section class="sources-list"');
  const aboutIdx = value.indexOf('<div class="about-vendor"');
  const cutIdx = [sourcesIdx, aboutIdx].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? -1;
  const content = cutIdx > 0 ? value.slice(0, cutIdx) : value;
  const lastH2 = content.lastIndexOf("<h2");
  if (lastH2 > 0) return value.slice(0, lastH2) + "\n" + html + "\n" + value.slice(lastH2);
  if (cutIdx > 0) return value.slice(0, cutIdx) + "\n" + html + "\n" + value.slice(cutIdx);
  return value + "\n" + html;
}

function buildRichBlock({ keyword, companyName, ctaUrl }) {
  const safeKeyword = escapeHtml(keyword || "Immobilienthema");
  const safeCompany = escapeHtml(companyName || "Baur Immobilien");
  const safeCtaUrl = escapeHtml(ctaUrl || "/kontakt/");
  return `
<section class="article-toolbox" aria-label="Praxis-Check">
  <h2>${safeKeyword}: Praxis-Check für die Entscheidung</h2>
  <p>Damit aus dem Thema eine klare Entscheidung wird, hilft ein strukturierter Blick auf Bedarf, Risiko und nächsten Schritt.</p>
  <div class="callout callout--info"><strong>Einordnung:</strong> Diese Übersicht ersetzt keine individuelle Prüfung, zeigt aber, welche Fragen vor einer Anfrage geklärt sein sollten.</div>
  <table class="comparison-table">
    <thead><tr><th>Prüfpunkt</th><th>Warum wichtig</th><th>Nächster Schritt</th></tr></thead>
    <tbody>
      <tr><td>Ausgangslage</td><td>Preis, Lage und Objektzustand entscheiden über die richtige Strategie.</td><td>Daten sammeln und realistisch einordnen.</td></tr>
      <tr><td>Marktsignal</td><td>Suchinteresse zeigt Bedarf, ersetzt aber keine lokale Bewertung.</td><td>Regionale Nachfrage mit Bestand abgleichen.</td></tr>
      <tr><td>Risiko</td><td>Falscher Intent führt zu schlechten Anfragen oder Kannibalisierung.</td><td>Bestehende Rechner-, Tool- und Landingpages abgrenzen.</td></tr>
      <tr><td>Kontaktpunkt</td><td>Leser brauchen einen passenden nächsten Schritt.</td><td>Beratung, Bewertung, Suchprofil oder Rechner gezielt verlinken.</td></tr>
    </tbody>
  </table>
  <ol class="process-steps">
    <li><strong>Signal prüfen:</strong> Welche Suchanfrage oder Seite zeigt echtes Interesse?</li>
    <li><strong>Bestand abgleichen:</strong> Gibt es bereits Rechner, Landingpage oder Ratgeber?</li>
    <li><strong>Lücke formulieren:</strong> Was fehlt dem Leser noch für die Entscheidung?</li>
    <li><strong>CTA wählen:</strong> Der nächste Schritt muss zum Intent passen, nicht nur zum Vertrieb.</li>
  </ol>
  <ul class="check-list">
    <li>Bestehende Baurimmo-Seiten sinnvoll verlinkt</li>
    <li>Keine Kopie einer Rechner- oder Tool-Seite</li>
    <li>Konkrete Beispiele statt allgemeiner SEO-Floskeln</li>
    <li>Mehrere CTA-Punkte im Artikel verteilt</li>
    <li>Social- und GBP-Winkel vorbereitet, aber nicht automatisch gepostet</li>
  </ul>
  <aside class="callout callout--cta">
    <p><strong>Aus der Praxis von ${safeCompany}:</strong> Gute Immobilienentscheidungen entstehen selten durch eine einzelne Kennzahl. Entscheidend ist, ob Markt, Objekt und persönliches Ziel zusammenpassen.</p>
    <p><a href="${safeCtaUrl}" class="callout__link">Passenden nächsten Schritt prüfen</a></p>
  </aside>
</section>`;
}

export function ensureRichArticle(article, { seo = {}, profile = {} } = {}) {
  if (!article?.body_html) return article;
  let body = String(article.body_html);
  const keyword = seo.primaryKeyword || article.primary_keyword || article.title || "Immobilienthema";
  const companyName = profile.company_name || "Baur Immobilien";
  const ctaUrl = profile.cta_url || profile.website_url || "/kontakt/";

  // 17.07.2026 (Audit): Die Praxis-Check-Injektion ist ABGESCHALTET.
  // buildRichBlock war ein hartcodierter Baurimmo-Redaktionsblock (interne
  // Prüfpunkte, "Bestehende Baurimmo-Seiten verlinkt", Immobilien-Texte),
  // der wegen ctaCount<4 in praktisch JEDEN Artikel ALLER Tenants rutschte —
  // die Quelle des tagelang gejagten "Praxis-Check-Leaks". Visuelle Dichte
  // erzwingt heute der Writer-Prompt; ein Lückenfüller darf nie wieder
  // fremde statische Inhalte injizieren.
  void insertBeforeFinalH2; void buildRichBlock; void hasClass; void stripHtml;
  void keyword; void companyName; void ctaUrl;

  article.body_html = body;
  return article;
}
