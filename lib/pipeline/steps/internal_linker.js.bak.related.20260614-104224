/**
 * Step 3d: INTERNAL LINKING ENGINE
 * Injiziert 3-4 kontextuelle interne Links in den neuen Artikel.
 * Nutzt bestehende published Posts des Tenants als Link-Quellen.
 * Topical Authority durch interne Verlinkung = stärkster Long-term-SEO-Hebel.
 *
 * Strategie:
 *   1. Alle published Posts des Tenants (selbe Sprache) laden
 *   2. Keyword-Overlap finden: kommt das Keyword eines anderen Posts im neuen Artikel vor?
 *   3. Längere Keywords bevorzugen (spezifischer, wertvoller)
 *   4. Nur in Text-Nodes ersetzen (nicht in headings, nicht in bereits verlinktem Text)
 */

import { query } from "../../db.js";

const MAX_LINKS = 4;

/**
 * @param {string} tenantId
 * @param {string} language
 * @param {string} bodyHtml - neuer Artikel-HTML
 * @param {string} tenantSlug - für URL-Generierung
 * @returns {string} bodyHtml mit eingefügten internen Links
 */
export async function injectInternalLinks(tenantId, language, bodyHtml, tenantSlug) {
  if (!bodyHtml) return bodyHtml;

  const { rows: posts } = await query(
    `SELECT blog_title, blog_slug, blog_primary_keyword, blog_url
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND status = 'published'
     ORDER BY published_at DESC LIMIT 60`,
    [tenantId, language]
  );

  if (!posts.length) return bodyHtml;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  // Kandidaten sortieren: längere Keywords zuerst (spezifischer = besser)
  const candidates = posts
    .filter(p => p.blog_primary_keyword && p.blog_primary_keyword.length > 3)
    .sort((a, b) => (b.blog_primary_keyword?.length || 0) - (a.blog_primary_keyword?.length || 0));

  // Bereits verlinkte URLs tracken (keine Doppellinks)
  const linkedUrls = new Set();
  let html = bodyHtml;
  let linksInjected = 0;

  for (const post of candidates) {
    if (linksInjected >= MAX_LINKS) break;

    const keyword = post.blog_primary_keyword;
    // blog_url = URL auf der Client-Site (wenn via Client-Push dort gelandet)
    // Fallback: unsere eigene Blog-URL
    const url = post.blog_url || `${baseUrl}/${tenantSlug}/${language}/blog/${post.blog_slug}`;

    if (linkedUrls.has(url)) continue;

    // Keyword im Text suchen — nur in Fließtext, nicht in:
    // - <h1>, <h2>, <h3> Tags
    // - Bestehenden <a> Tags
    // - HTML-Attributen
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Negative lookbehind/lookahead: nicht innerhalb von Tags, nicht schon verlinkt
    // Wir ersetzen das erste Vorkommen außerhalb von Tags
    const replaced = replaceFirstInText(html, keyword, `<a href="${url}" class="internal-link">${keyword}</a>`);

    if (replaced !== html) {
      html = replaced;
      linkedUrls.add(url);
      linksInjected++;
    }
  }

  return html;
}

/**
 * Ersetzt das erste Vorkommen von `search` in Text-Nodes des HTML.
 * Text-Nodes = Inhalt zwischen Tags, nicht innerhalb von Tags selbst.
 * Überspringt: Überschriften (h1-h3), bereits verlinkte Texte (<a>).
 */
function replaceFirstInText(html, search, replacement) {
  // Split HTML in Tags und Text-Nodes
  // Pattern: alles zwischen > und < ist Text, alles in <> ist ein Tag
  const lower = search.toLowerCase();
  let result = "";
  let remaining = html;
  let depth = 0; // 0 = nicht in einem zu-überspringenden Block
  let skipTag = 0; // Tiefe des Skip-Tags (h1-h3, a)
  let replaced = false;

  // Tokenize: Tags vs Text
  const TOKEN_PATTERN = /(<[^>]+>)|([^<]+)/g;
  let match;

  while ((match = TOKEN_PATTERN.exec(html)) !== null) {
    const tag = match[1];
    const text = match[2];

    if (tag) {
      const tagLower = tag.toLowerCase();
      const isOpenSkip = /^<(h[123]|a)[\s>]/.test(tagLower);
      const isCloseSkip = /^<\/(h[123]|a)>/.test(tagLower);

      if (isOpenSkip) skipTag++;
      if (isCloseSkip && skipTag > 0) skipTag--;

      result += tag;
    } else if (text) {
      // Nur in Text-Nodes ersetzen, wenn nicht in Skip-Block
      if (!replaced && skipTag === 0) {
        const idx = text.toLowerCase().indexOf(lower);
        if (idx !== -1) {
          // Wortgrenzen prüfen (kein Ersatz mitten im Wort)
          const before = text[idx - 1];
          const after = text[idx + search.length];
          const validBefore = !before || /[\s,.(;"'—–]/.test(before);
          const validAfter = !after || /[\s,.(;"'—–:!?]/.test(after);

          if (validBefore && validAfter) {
            result += text.slice(0, idx) + replacement + text.slice(idx + search.length);
            replaced = true;
            continue;
          }
        }
      }
      result += text;
    }
  }

  return result;
}
