/**
 * Step 3d: INTERNAL LINKING ENGINE (v2 — verstärkt 2026-06-14)
 * Injiziert 4-6 kontextuelle interne Links in den neuen Artikel.
 *
 * Aenderungen v2:
 *   - Client-Base-URL aus tenant_settings.client_api_url ableiten
 *     (Origin von client_api_url → Links zeigen auf die Live-Kunden-Site,
 *     nicht mehr auf ghostwriter.code-lederhos.de)
 *   - Mehrfache Match-Strategien je Kandidat:
 *       a) volles primary_keyword
 *       b) Titel (oder Titel-Hauptphrase vor ":" / "–")
 *       c) Keyword-Token-Variationen (Stem-Light: erstes Token, letztes Token,
 *          ersten 2 Tokens)
 *   - Bis zu 5 Links statt 4
 *   - Mindestens 2 Links angestrebt; wenn nach erster Runde < 2 erreicht,
 *     "Lies auch:"-Snippet vor letztem </p> einsetzen (Mini-Inline-Box)
 *   - Robust gegen leere/Null-Felder
 *
 * v3 (2026-07-12): "Mehr zum Thema"-Related-Box vor dem Fazit-<h2> mit ECHTEN
 * veröffentlichten Artikeln: GW-published zuerst, dann Blog-URLs aus der
 * Sitemap der Tenant-Domain (https://<tenants.domain>/sitemap.xml), thematisch
 * passendste per Wort-Overlap zum Artikel-Keyword, max 3.
 */

import { query } from "../../db.js";

const MAX_LINKS = 5;
const MAX_RELATED = 3;

/**
 * @param {string} tenantId
 * @param {string} language
 * @param {string} bodyHtml
 * @param {string} tenantSlug
 * @param {{ tenantDomain?: string|null, articleKeyword?: string, ownSlug?: string|null }} opts
 * @returns {string}
 */
export async function injectInternalLinks(tenantId, language, bodyHtml, tenantSlug, opts = {}) {
  if (!bodyHtml) return bodyHtml;
  const { tenantDomain = null, articleKeyword = "", ownSlug = null } = opts;

  // Client-Base-URL aus tenant_settings.client_api_url ableiten (Origin)
  let clientBaseUrl = null;
  try {
    const { rows: ts } = await query(
      `SELECT client_api_url, client_push_enabled FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    if (ts.length && ts[0].client_push_enabled && ts[0].client_api_url) {
      try {
        const u = new URL(ts[0].client_api_url);
        clientBaseUrl = `${u.protocol}//${u.host}`;
      } catch { /* invalid URL — Fallback unten */ }
    }
  } catch { /* DB / Spalten optional */ }

  const { rows: posts } = await query(
    `SELECT blog_title, blog_slug, blog_primary_keyword, blog_url, category
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND status = 'published'
     ORDER BY published_at DESC LIMIT 80`,
    [tenantId, language]
  );

  // Sitemap-Kandidaten der Tenant-Domain (parallel wäre schöner, aber Reihenfolge ist hier egal)
  const sitemapPosts = await fetchSitemapBlogCandidates(tenantDomain, ownSlug, language);

  if (!posts.length && !sitemapPosts.length) return bodyHtml;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  const linkedUrls = new Set();
  let html = bodyHtml;
  let linksInjected = 0;

  // Kandidaten: nach Keyword-Länge sortieren (spezifischer zuerst)
  const candidates = posts
    .filter(p => p.blog_slug)
    .map(p => ({
      ...p,
      _searchTerms: buildSearchTerms(p),
    }))
    .filter(p => p._searchTerms.length > 0)
    .sort((a, b) => {
      const aMax = Math.max(...a._searchTerms.map(s => s.length));
      const bMax = Math.max(...b._searchTerms.map(s => s.length));
      return bMax - aMax;
    });

  for (const post of candidates) {
    if (linksInjected >= MAX_LINKS) break;

    // URL: bevorzugt clientBaseUrl/blog/<slug>, sonst blog_url, sonst Fallback
    const url = clientBaseUrl
      ? `${clientBaseUrl}/blog/${post.blog_slug}`
      : (post.blog_url || `${baseUrl}/${tenantSlug}/${language}/blog/${post.blog_slug}`);

    if (linkedUrls.has(url)) continue;

    // Mehrere Anker-Phrasen probieren — erstes Match gewinnt
    let matched = false;
    for (const term of post._searchTerms) {
      const replaced = replaceFirstInText(
        html,
        term,
        `<a href="${url}" class="internal-link">${term}</a>`
      );
      if (replaced !== html) {
        html = replaced;
        linkedUrls.add(url);
        linksInjected++;
        matched = true;
        break;
      }
    }
    // Kein Hard-Fail bei fehlendem Match — naechster Kandidat
    void matched;
  }

  // "Mehr zum Thema"-Related-Box vor dem Fazit-<h2>:
  // GW-published zuerst, dann Sitemap-Artikel — thematisch passendste per
  // Wort-Overlap zum Artikel-Keyword, max MAX_RELATED. Nur echte URLs.
  if (!/class="related-posts"/.test(html)) {
    const gwUrl = (p) => clientBaseUrl
      ? `${clientBaseUrl}/blog/${p.blog_slug}`
      : (p.blog_url || `${baseUrl}/${tenantSlug}/${language}/blog/${p.blog_slug}`);

    const gwRelated = candidates
      .filter(p => !linkedUrls.has(gwUrl(p)) && (!ownSlug || p.blog_slug !== ownSlug))
      .map(p => ({
        url: gwUrl(p),
        title: p.blog_title || p.blog_slug,
        _score: wordOverlapScore(articleKeyword, `${p.blog_title || ""} ${p.blog_primary_keyword || ""}`),
      }))
      .sort((a, b) => b._score - a._score);

    const smRelated = sitemapPosts
      .filter(p => !linkedUrls.has(p.url))
      .map(p => ({ ...p, _score: wordOverlapScore(articleKeyword, p.title) }))
      .sort((a, b) => b._score - a._score);

    const relatedItems = [];
    const relatedUrls = new Set();
    for (const item of [...gwRelated, ...smRelated]) {
      if (relatedItems.length >= MAX_RELATED) break;
      // Kein thematischer Bezug (Score 0) -> NIE verlinken. Themenfremde
      // Auffüller (KI-Geopolitik im Back-Office-Artikel) schaden mehr als
      // eine fehlende "Mehr zum Thema"-Box.
      if (item._score === 0) continue;
      if (relatedUrls.has(item.url)) continue;
      relatedUrls.add(item.url);
      relatedItems.push(item);
    }

    if (relatedItems.length >= 2) {
      const label = language === "de" ? "Mehr zum Thema" : "More on this topic";
      const itemsHtml = relatedItems
        .map(it => `<li><a href="${escapeHtml(it.url)}" class="internal-link">${escapeHtml(it.title)}</a></li>`)
        .join("");
      const box = `<div class="related-posts"><p><strong>${label}:</strong></p><ul>${itemsHtml}</ul></div>`;
      html = insertBeforeFinalH2(html, box);
    }
  }

  return html;
}

/**
 * Holt Blog-URLs aus der Sitemap der Tenant-Domain (https://<domain>/sitemap.xml).
 * Fehler werden still ignoriert (Timeout 8s). Nur /blog/-URLs, ohne Blog-Index,
 * ohne eigenen Slug, ohne fremdsprachige Pfade (/en/... bei language=de).
 * @returns {Array<{ url: string, slug: string, title: string }>}
 */
async function fetchSitemapBlogCandidates(domain, ownSlug, language) {
  if (!domain) return [];
  const host = String(domain).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host) return [];
  try {
    const res = await fetch(`https://${host}/sitemap.xml`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "GhostwriterBot/1.0 (+internal-linker)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => m[1].trim());
    const out = [];
    const seen = new Set();
    for (const loc of locs) {
      if (!/\/blog\//.test(loc)) continue;
      let u;
      try { u = new URL(loc); } catch { continue; }
      // Fremdsprachige Sektion ausschließen (z.B. /en/blog/... bei language=de)
      const langSeg = u.pathname.match(/^\/([a-z]{2})\//);
      if (langSeg && langSeg[1] !== language) continue;
      const slug = u.pathname.replace(/\/+$/, "").split("/").pop() || "";
      if (!slug || slug === "blog") continue;
      const cleanSlug = slug.replace(/\.php$/i, "");
      if (ownSlug && cleanSlug === ownSlug) continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      out.push({ url: u.href, slug: cleanSlug, title: humanizeSlug(cleanSlug) });
    }
    return out;
  } catch {
    return []; // Sitemap nicht erreichbar — still ignorieren
  }
}

/**
 * Slug → lesbarer Titel: Bindestriche zu Leerzeichen, Wörter groß.
 * KEINE Umlaut-Rückschreibung (ae→ä wäre zu fehleranfällig).
 */
const ACRONYMS = { ki: "KI", ai: "AI", seo: "SEO", it: "IT", dsgvo: "DSGVO", gmbh: "GmbH", nis2: "NIS2", api: "API" };

function humanizeSlug(slug) {
  return String(slug)
    .replace(/^\d{4}-\d{2}-\d{2}-/, "") // Datums-Präfix weg
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(w => ACRONYMS[w.toLowerCase()] || (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

/**
 * Einfacher Wort-Overlap-Score: wie viele Keyword-Wörter (≥4 Zeichen)
 * kommen im Kandidaten-Text vor.
 */
function wordOverlapScore(keyword, text) {
  const norm = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/gi, " ")
    .split(/[\s-]+/)
    .filter(w => w.length >= 4);
  const kw = new Set(norm(keyword));
  if (!kw.size) return 0;
  let hits = 0;
  for (const w of new Set(norm(text))) {
    if (kw.has(w)) hits++;
  }
  return hits;
}

function insertBeforeFinalH2(html, snippet) {
  const value = String(html || "");
  // Quellen-Section + AEO-About-Block gehören ans Ende — deren <h2> ist nicht das Fazit
  const sourcesIdx = value.indexOf('<section class="sources-list"');
  const aboutIdx = value.indexOf('<div class="about-vendor"');
  const cutIdx = [sourcesIdx, aboutIdx].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? -1;
  const content = cutIdx > 0 ? value.slice(0, cutIdx) : value;
  const lastH2 = content.lastIndexOf("<h2");
  if (lastH2 > 0) return value.slice(0, lastH2) + snippet + "\n" + value.slice(lastH2);
  if (cutIdx > 0) return value.slice(0, cutIdx) + snippet + value.slice(cutIdx);
  return insertBeforeLastClosingP(value, snippet);
}

/**
 * Bauen Liste aussagekraeftiger Anker-Phrasen je Post.
 * - primary_keyword (full)
 * - Titel-Kernphrase (vor ":" / "–" / "|") wenn != keyword
 * - Letzte 2 Tokens des Keywords (z.B. "verkaufen Tipps")
 * - Letztes Token (Substantiv-Heuristik) — nur wenn ≥ 5 Zeichen
 */
function buildSearchTerms(post) {
  const terms = [];
  const seen = new Set();
  const add = (t) => {
    if (!t) return;
    const trimmed = t.trim();
    if (trimmed.length < 4) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(trimmed);
  };

  const kw = (post.blog_primary_keyword || "").trim();
  if (kw) add(kw);

  const title = (post.blog_title || "").trim();
  if (title) {
    // Erste Phrase vor :, – oder | nehmen
    const core = title.split(/[:–\-—|]/)[0].trim();
    if (core && core.length > 6 && core.length <= 80) add(core);
  }

  if (kw) {
    const tokens = kw.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      // letzte 2 Tokens
      add(tokens.slice(-2).join(" "));
    }
    if (tokens.length >= 1) {
      const last = tokens[tokens.length - 1];
      if (last.length >= 5) add(last);
    }
  }

  return terms;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function insertBeforeLastClosingP(html, snippet) {
  const idx = html.lastIndexOf("</p>");
  if (idx === -1) return html + snippet;
  return html.slice(0, idx + 4) + snippet + html.slice(idx + 4);
}

/**
 * Ersetzt das erste Vorkommen von `search` in Text-Nodes des HTML.
 * Überspringt: Überschriften (h1-h3), bereits verlinkte Texte (<a>).
 */
function replaceFirstInText(html, search, replacement) {
  const lower = search.toLowerCase();
  let result = "";
  let skipTag = 0;
  let replaced = false;

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
      if (!replaced && skipTag === 0) {
        const idx = text.toLowerCase().indexOf(lower);
        if (idx !== -1) {
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
