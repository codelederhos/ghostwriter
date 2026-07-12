/**
 * Server-Helper: injiziert Anker-IDs in <h2>-Tags eines Blog-Bodys.
 * Wird von der Review-Preview UND der Tenant-Blog-Seite genutzt, damit der
 * Floating-TOC (ReaderExperience.jsx) auf beiden Seiten dieselben Anker findet.
 *
 * Wichtig: N zählt POSITIONELL über alle h2 (auch solche mit vorhandener id),
 * damit die Nummerierung stabil bleibt, wenn einzelne h2 bereits ids haben.
 */
export function injectH2Ids(html) {
  let n = 0;
  return String(html || "").replace(/<h2\b([^>]*)>/gi, (match, attrs) => {
    n += 1;
    if (/\bid\s*=/i.test(attrs || "")) return match;
    return `<h2 id="abschnitt-${n}"${attrs || ""}>`;
  });
}
