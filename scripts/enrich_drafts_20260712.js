#!/usr/bin/env node
/**
 * Enrich-Skript für 5 Bestands-Drafts (2026-07-12, Stani-Feedback Charts + Sales).
 *
 * Läuft IM App-Container:
 *   docker exec -e NODE_PATH=/app/node_modules <app> node /app/scripts/enrich_drafts_20260712.js
 *   (DATABASE_URL vorhanden, QuickChart intern http://quickchart:3400)
 *
 * Pro Draft:
 *   a) NUR Draft 40993a0d (cl KI-Mitarbeiter): kaputtes .gw-chart-Element ersetzen —
 *      Chart via QuickChart neu rendern (bar, saubere Optionen, kein Titel im Bild,
 *      Legende aus), PNG nach /app/public/uploads/, Einbettung mit HTML-Titel.
 *   b) ALLE: "Mehr zum Thema"-Related-Box vor dem Fazit-<h2> mit 2-3 echten
 *      Blog-URLs aus der Sitemap der Tenant-Domain. Sitemap leer/unerreichbar →
 *      Related-Box für den Draft überspringen + loggen (übrige Schritte laufen).
 *   c) ALLE: 1 Button-CTA-Block nach dem 3. <h2> — Ziel-URL aus vorhandenem
 *      CTA-Link des Drafts (erster https-Link auf die eigene Tenant-Domain in
 *      einem cta-Element), sonst https://<domain>/.
 *   d) ALLE: Firmenname < 3x im Body → Empfehlungssatz im Fazit-Absatz ergänzen.
 *
 * Idempotent: Marker werden geprüft (gw-chart__title / related-posts / cta-button /
 * "findet bei <Firma>"), nichts wird doppelt eingefügt.
 *
 * DRY_RUN=1 → keine DB-Writes, nur Logging.
 */

const { Client } = require("pg");
const fs = require("node:fs/promises");
const path = require("node:path");

const QUICKCHART_URL = process.env.QUICKCHART_URL || "http://quickchart:3400";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const DRY_RUN = process.env.DRY_RUN === "1";

const CHART_FIX_ID = "40993a0d-3880-4dac-b209-4bdbdde8e1cd";

const DRAFT_IDS = [
  "40993a0d-3880-4dac-b209-4bdbdde8e1cd", // cl — KI-Mitarbeiter (kaputtes Chart)
  "ce861622-bdf4-4b99-9594-1be9f109c3b1", // cl — Backoffice
  "f3e60d56-6c5d-4b17-beb6-926f03b9441d",
  "71819770-6ccc-4cd3-b0c7-0908662b32f6",
  "f8c8f26d-ad47-4c18-81a5-3d2acfdbc2f1", // staned
];

// Fallback-Firmennamen falls tenant_profiles.company_name leer
const COMPANY_BY_DOMAIN = {
  "code-lederhos.de": "Code Lederhos",
  "staned-gmbh.de": "STANED GmbH",
};

/* ── Helpers ──────────────────────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeDomain(domain) {
  return String(domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Vor dem letzten <h2> (Fazit) einfügen — Quellen-Section ignorieren. */
function insertBeforeFinalH2(html, snippet) {
  const value = String(html || "");
  const sourcesIdx = value.indexOf('<section class="sources-list"');
  const content = sourcesIdx > 0 ? value.slice(0, sourcesIdx) : value;
  const lastH2 = content.lastIndexOf("<h2");
  if (lastH2 > 0) return value.slice(0, lastH2) + snippet + "\n" + value.slice(lastH2);
  if (sourcesIdx > 0) return value.slice(0, sourcesIdx) + snippet + value.slice(sourcesIdx);
  const lastP = value.lastIndexOf("</p>");
  if (lastP !== -1) return value.slice(0, lastP + 4) + snippet + value.slice(lastP + 4);
  return value + snippet;
}

/** Nach dem 3. <h2> einfügen (nach dem ersten </p> des Abschnitts). */
function insertAfterThirdH2(html, snippet) {
  const value = String(html || "");
  const h2s = [...value.matchAll(/<h2[\s>]/gi)];
  if (h2s.length >= 3) {
    const from = h2s[2].index;
    const pClose = value.indexOf("</p>", from);
    if (pClose !== -1) {
      const at = pClose + 4;
      return value.slice(0, at) + "\n" + snippet + value.slice(at);
    }
  }
  return insertBeforeFinalH2(value, snippet);
}

/** Wort-Overlap-Score (Wörter >= 4 Zeichen). */
function wordOverlapScore(keyword, text) {
  const norm = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/gi, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4);
  const kw = new Set(norm(keyword));
  if (!kw.size) return 0;
  let hits = 0;
  for (const w of new Set(norm(text))) if (kw.has(w)) hits++;
  return hits;
}

/** Slug → lesbarer Titel (keine Umlaut-Rückschreibung). */
function humanizeSlug(slug) {
  return String(slug)
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

/** Blog-URLs aus der Sitemap der Domain (8s Timeout, Fehler → []). */
async function fetchSitemapBlogUrls(domain, ownSlug) {
  const host = normalizeDomain(domain);
  if (!host) return [];
  try {
    const res = await fetch(`https://${host}/sitemap.xml`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "GhostwriterEnrich/1.0" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].trim());
    const out = [];
    const seen = new Set();
    for (const loc of locs) {
      if (!/\/blog\//.test(loc)) continue;
      let u;
      try { u = new URL(loc); } catch { continue; }
      // fremdsprachige Sektionen (z.B. /en/blog/) überspringen — Drafts sind deutsch
      const langSeg = u.pathname.match(/^\/([a-z]{2})\//);
      if (langSeg && langSeg[1] !== "de") continue;
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
    return [];
  }
}

/** Chart via QuickChart rendern → { localPath } oder null. */
async function renderChartPng(chartConfig, slug) {
  const payload = {
    chart: JSON.stringify(chartConfig),
    width: 800,
    height: 480,
    devicePixelRatio: 2,
    backgroundColor: "white",
    format: "png",
    version: "3",
  };
  const res = await fetch(`${QUICKCHART_URL}/chart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QuickChart ${res.status}: ${err.slice(0, 200)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${slug}-chart-${Date.now()}.png`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return { localPath: `/uploads/${filename}` };
}

/** Ersten https-CTA-Link auf die eigene Domain finden (in cta-/callout--cta-Elementen). */
function findExistingCtaUrl(body, domain) {
  const host = escapeRegExp(normalizeDomain(domain));
  if (!host) return null;
  const ctaClassRe = /class="[^"]*(?:cta-inline|cta-block|callout--cta|cta-button|cta-block__btn|callout__link)[^"]*"/gi;
  const hrefRe = new RegExp(`href="(https:\\/\\/(?:www\\.)?${host}[^"]*)"`, "i");
  let m;
  while ((m = ctaClassRe.exec(body)) !== null) {
    // im Umfeld des CTA-Elements (800 Zeichen voraus + 200 zurück) nach Domain-Link suchen
    const windowStart = Math.max(0, m.index - 200);
    const windowText = body.slice(windowStart, m.index + 800);
    const href = windowText.match(hrefRe);
    if (href) return href[1];
  }
  return null;
}

/* ── Schritt a: kaputtes Chart im cl-KI-Draft ersetzen ────────────────── */

async function fixBrokenChart(post, actions) {
  if (post.blog_body.includes("gw-chart__title")) {
    actions.push("chart: SKIP (gw-chart__title bereits vorhanden — schon gefixt)");
    return post.blog_body;
  }
  const chartElRe = /<div class="gw-chart">[\s\S]*?<\/div>/;
  if (!chartElRe.test(post.blog_body)) {
    actions.push("chart: SKIP (kein .gw-chart-Element im Body gefunden)");
    return post.blog_body;
  }

  // Daten aus dem Artikel: typische Zeiteinsparung pro Woche in Stunden
  const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed"];
  const chartConfig = {
    type: "bar",
    data: {
      labels: ["Posteingang", "Rechnungsprüfung", "Angebotserstellung", "Backoffice-Erfassung", "Support"],
      datasets: [{
        label: "Stunden pro Woche",
        data: [4, 5, 5, 6, 3],
        backgroundColor: PALETTE.map((c) => c + "dd"),
      }],
    },
    options: {
      layout: { padding: 16 },
      plugins: {
        title: { display: false },   // Titel kommt als HTML über das Bild
        legend: { display: false },  // 1 Dataset → Legende aus
      },
      scales: {
        y: { beginAtZero: true, grace: "5%", title: { display: false }, ticks: { font: { size: 12 } } },
        x: { title: { display: false }, ticks: { autoSkip: true, maxRotation: 30, minRotation: 0, font: { size: 12 } } },
      },
    },
  };

  let rendered;
  try {
    rendered = await renderChartPng(chartConfig, post.blog_slug || "ki-mitarbeiter");
  } catch (err) {
    actions.push(`chart: FEHLER QuickChart (${err.message}) — Body unverändert, übrige Schritte laufen weiter`);
    return post.blog_body;
  }
  const title = "Typische Zeiteinsparung pro Woche (Stunden)";
  const src = `${PUBLIC_BASE}${rendered.localPath}`;
  const embed = `<div class="gw-chart"><p class="gw-chart__title">${escapeHtml(title)}</p><img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" width="800" height="480" loading="lazy"></div>`;

  actions.push(`chart: ersetzt (neues PNG ${rendered.localPath})`);
  return post.blog_body.replace(chartElRe, embed);
}

/* ── Schritt b: Related-Box aus Sitemap ───────────────────────────────── */

async function addRelatedBox(post, actions) {
  if (/class="related-posts"/.test(post.blog_body)) {
    actions.push("related: SKIP (related-posts bereits vorhanden)");
    return post.blog_body;
  }
  const candidates = await fetchSitemapBlogUrls(post.domain, post.blog_slug);
  if (!candidates.length) {
    actions.push(`related: SKIP (Sitemap https://${normalizeDomain(post.domain)}/sitemap.xml leer/unerreichbar)`);
    return post.blog_body;
  }

  const topic = `${post.blog_title || ""} ${post.blog_primary_keyword || ""}`;
  const scoredAll = candidates
    .map((c) => ({ ...c, _score: wordOverlapScore(topic, c.title) }))
    .sort((a, b) => b._score - a._score);
  // 0-Score (kein thematischer Bezug) nur als Auffüller bis zum 2-Link-Minimum
  const thematic = scoredAll.filter((c) => c._score > 0).slice(0, 3);
  const ranked = thematic.length >= 2
    ? thematic
    : [...thematic, ...scoredAll.filter((c) => c._score === 0)].slice(0, 2);

  if (ranked.length < 2) {
    actions.push(`related: SKIP (nur ${ranked.length} Kandidat(en) — mind. 2 nötig)`);
    return post.blog_body;
  }

  const items = ranked
    .map((c) => `<li><a href="${escapeHtml(c.url)}" class="internal-link">${escapeHtml(c.title)}</a></li>`)
    .join("");
  const box = `<div class="related-posts"><p><strong>Mehr zum Thema:</strong></p><ul>${items}</ul></div>`;
  actions.push(`related: eingefügt (${ranked.length} Links: ${ranked.map((c) => c.slug).join(", ")})`);
  return insertBeforeFinalH2(post.blog_body, box);
}

/* ── Schritt c: Button-CTA nach dem 3. h2 ─────────────────────────────── */

function addButtonCta(post, actions) {
  if (/class="cta-button"/.test(post.blog_body)) {
    actions.push("button-cta: SKIP (cta-button bereits vorhanden)");
    return post.blog_body;
  }
  const host = normalizeDomain(post.domain);
  const existing = findExistingCtaUrl(post.blog_body, post.domain);
  const url = existing || (host ? `https://${host}/` : null);
  if (!url) {
    actions.push("button-cta: SKIP (keine Tenant-Domain, keine Ziel-URL)");
    return post.blog_body;
  }
  const block = `<div class="cta-block"><a class="cta-button" href="${escapeHtml(url)}">Kostenlose Erstberatung anfragen</a></div>`;
  actions.push(`button-cta: eingefügt nach 3. h2 (Ziel: ${url}${existing ? " — aus vorhandenem CTA übernommen" : " — Fallback Domain-Root"})`);
  return insertAfterThirdH2(post.blog_body, block);
}

/* ── Schritt d: Marken-Empfehlungssatz im Fazit ───────────────────────── */

function addBrandRecommendation(post, actions) {
  const company = post.company_name || COMPANY_BY_DOMAIN[normalizeDomain(post.domain)] || null;
  if (!company) {
    actions.push("brand: SKIP (kein Firmenname ermittelbar)");
    return post.blog_body;
  }
  const text = stripHtml(post.blog_body);
  const count = (text.match(new RegExp(escapeRegExp(company), "gi")) || []).length;
  if (count >= 3) {
    actions.push(`brand: SKIP (${company} bereits ${count}x im Body)`);
    return post.blog_body;
  }
  const marker = new RegExp(`findet bei\\s+${escapeRegExp(company)}`, "i");
  if (marker.test(text)) {
    actions.push("brand: SKIP (Empfehlungssatz bereits vorhanden)");
    return post.blog_body;
  }

  const topic = post.blog_primary_keyword || "dieses Thema";
  const sentence = ` Wer dabei Unterstützung sucht, findet bei ${escapeHtml(company)} praxisnahe Beratung und Umsetzung rund um ${escapeHtml(topic)}.`;

  // Fazit-Absatz: erster <p>…</p> nach dem letzten <h2> (Quellen ignorieren)
  const value = post.blog_body;
  const sourcesIdx = value.indexOf('<section class="sources-list"');
  const content = sourcesIdx > 0 ? value.slice(0, sourcesIdx) : value;
  const lastH2 = content.lastIndexOf("<h2");
  if (lastH2 === -1) {
    actions.push("brand: SKIP (kein <h2> für Fazit gefunden)");
    return value;
  }
  const pClose = content.indexOf("</p>", lastH2);
  if (pClose === -1) {
    actions.push("brand: SKIP (kein Fazit-<p> nach letztem <h2>)");
    return value;
  }
  actions.push(`brand: Empfehlungssatz ergänzt (${company} war ${count}x im Body)`);
  return value.slice(0, pClose) + sentence + value.slice(pClose);
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`[enrich] Start ${new Date().toISOString()} ${DRY_RUN ? "(DRY_RUN — keine DB-Writes)" : ""}`);

  let okCount = 0;
  let failCount = 0;

  for (const id of DRAFT_IDS) {
    const actions = [];
    try {
      const { rows } = await client.query(
        `SELECT p.id, p.blog_body, p.blog_slug, p.blog_title, p.blog_primary_keyword, p.status,
                t.domain, prof.company_name
         FROM ghostwriter_posts p
         JOIN tenants t ON t.id = p.tenant_id
         LEFT JOIN tenant_profiles prof ON prof.tenant_id = t.id
         WHERE p.id = $1`,
        [id]
      );
      if (!rows.length) {
        console.log(`[enrich] ${id}: NICHT GEFUNDEN — übersprungen`);
        failCount++;
        continue;
      }
      const post = rows[0];
      if (!post.blog_body) {
        console.log(`[enrich] ${id}: leerer Body — übersprungen`);
        failCount++;
        continue;
      }
      const original = post.blog_body;

      // a) Chart-Fix nur für den cl-KI-Draft
      if (id === CHART_FIX_ID) {
        post.blog_body = await fixBrokenChart(post, actions);
      }
      // b) Related-Box aus Sitemap
      post.blog_body = await addRelatedBox(post, actions);
      // c) Button-CTA nach dem 3. h2
      post.blog_body = addButtonCta(post, actions);
      // d) Marken-Empfehlungssatz
      post.blog_body = addBrandRecommendation(post, actions);

      const changed = post.blog_body !== original;
      if (changed && !DRY_RUN) {
        await client.query(
          `UPDATE ghostwriter_posts SET blog_body = $1, updated_at = NOW() WHERE id = $2`,
          [post.blog_body, id]
        );
      }
      console.log(`[enrich] ${id} (${post.blog_slug}, ${normalizeDomain(post.domain)}, status=${post.status}) → ${changed ? (DRY_RUN ? "WÜRDE SCHREIBEN" : "GESPEICHERT") : "unverändert"}`);
      for (const a of actions) console.log(`         - ${a}`);
      okCount++;
    } catch (err) {
      console.error(`[enrich] ${id}: FEHLER — ${err.message}`);
      for (const a of actions) console.log(`         - ${a}`);
      failCount++;
    }
  }

  await client.end();
  console.log(`[enrich] Fertig: ${okCount} ok, ${failCount} übersprungen/Fehler`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[enrich] Fatal:", err);
  process.exit(1);
});
