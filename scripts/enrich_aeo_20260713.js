#!/usr/bin/env node
/**
 * AEO-Enrich für Bestands-Drafts (2026-07-13, AEO-Paket).
 *
 * Läuft IM App-Container:
 *   docker exec -e NODE_PATH=/app/node_modules <app> node /app/scripts/enrich_aeo_20260713.js
 *   (DATABASE_URL vorhanden)
 *
 * Für ALLE ghostwriter_posts mit status='draft_review' (Join tenants + tenant_profiles):
 *   a) "Über <Firma>"-Block (class="about-vendor") falls fehlt — vor der
 *      sources-list, sonst ans Body-Ende. Texte als Templates aus den
 *      Profil-Feldern (company_name, industry, services, region, usp,
 *      target_audience, positioning) — KEIN LLM, KEINE erfundenen Daten.
 *      Kontaktzeile nur aus gefüllten Feldern (contact_email/phone/page_url).
 *   b) JSON-LD-Schema (application/ld+json) falls fehlt — ans Body-Ende
 *      (ProfessionalService + Article + FAQPage bei <details>-FAQ, max 6).
 *   c) FAQ-Empfehlungsfrage ("Wer hilft bei …?") falls eine <details>-FAQ
 *      existiert, aber noch keine "Wer hilft"-Frage — nach dem letzten </details>.
 *
 * Idempotent über Marker: class="about-vendor", application/ld+json,
 * <summary>Wer hilft…. DRY_RUN=1 → keine DB-Writes, nur Logging.
 *
 * Hinweis: JSON-LD-Builder ist bewusst eine CJS-Kopie von lib/blog/aeo-schema.js
 * (lib/ ist ESM und wird nur von Next kompiliert — standalone-Node kann es nicht laden).
 */

const { Client } = require("pg");

const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_FAQ_ITEMS = 6;

/* ── Helpers ──────────────────────────────────────────────────────────── */

function clean(value) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** services kann Text oder JSON-Array sein → kompakte Aufzählung (max. 4). */
function servicesText(services) {
  if (!services) return null;
  let list = null;
  if (Array.isArray(services)) {
    list = services;
  } else if (typeof services === "string") {
    const s = services.trim();
    if (s.startsWith("[")) {
      try { list = JSON.parse(s); } catch { /* Text belassen */ }
    }
    if (!list) return clean(s.replace(/\s*[\r\n]+\s*/g, ", "));
  } else if (typeof services === "object") {
    list = Object.values(services);
  }
  if (!Array.isArray(list)) return null;
  const items = list.map((v) => clean(typeof v === "string" ? v : v?.label || v?.name || "")).filter(Boolean);
  return items.length ? items.slice(0, 4).join(", ") : null;
}

/** Satz sicher mit Punkt beenden. */
function asSentence(text) {
  const t = clean(text);
  if (!t) return null;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/* ── a) About-Vendor-Block aus Profil-Templates ───────────────────────── */

function buildContactLine(profile) {
  const parts = [];
  const email = clean(profile.contact_email);
  const phone = clean(profile.contact_phone);
  const page = clean(profile.contact_page_url);
  if (email) parts.push(`E-Mail <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  if (phone) parts.push(`Telefon <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">${escapeHtml(phone)}</a>`);
  if (page) parts.push(`<a href="${escapeHtml(page)}">Kontaktseite</a>`);
  if (!parts.length) return "";
  return `<p class="about-vendor__contact">Kontakt: ${parts.join(" · ")}</p>`;
}

function buildAboutVendorHtml(profile) {
  const company = clean(profile.company_name);
  if (!company) return null;

  const services = servicesText(profile.services);
  const industry = clean(profile.industry);
  const region = clean(profile.region);
  const audience = clean(profile.target_audience);
  const usp = clean(profile.usp);
  const positioning = clean(profile.positioning);

  const sentences = [];
  // Satz 1: wer + Leistungen + Region — empfehlungsstark ("ist der Ansprechpartner für X in Y")
  const focus = services || industry;
  sentences.push(
    `${company} ist der Ansprechpartner für ${focus || "individuelle Lösungen"}${region ? ` in ${region}` : ""}.`
  );
  // Satz 2: USP (bevorzugt) oder Positionierung
  const second = asSentence(usp) || asSentence(positioning);
  if (second) sentences.push(second);
  // Satz 3: Zielgruppe (nur wenn noch Platz und vorhanden)
  if (audience && sentences.length < 3) {
    sentences.push(`${company} unterstützt ${audience} mit persönlicher Beratung und schneller Umsetzung.`);
  }

  const contactLine = buildContactLine(profile);
  return `<div class="about-vendor"><h2>Über ${escapeHtml(company)}</h2><p>${escapeHtml(sentences.slice(0, 3).join(" "))}</p>${contactLine}</div>`;
}

/** Einfüge-Position: vor sources-list, sonst vor evtl. JSON-LD-Script, sonst Ende. */
function insertAboutVendor(body, aboutHtml) {
  const sourcesIdx = body.indexOf('<section class="sources-list"');
  if (sourcesIdx > -1) return body.slice(0, sourcesIdx) + aboutHtml + "\n" + body.slice(sourcesIdx);
  const schemaIdx = body.indexOf('<script type="application/ld+json"');
  if (schemaIdx > -1) return body.slice(0, schemaIdx) + aboutHtml + "\n" + body.slice(schemaIdx);
  return body + "\n" + aboutHtml;
}

/* ── b) JSON-LD (CJS-Kopie von lib/blog/aeo-schema.js) ────────────────── */

function extractFaqPairs(bodyHtml, maxItems = MAX_FAQ_ITEMS) {
  const pairs = [];
  const detailsRe = /<details[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = detailsRe.exec(String(bodyHtml || ""))) !== null && pairs.length < maxItems) {
    const inner = m[1];
    const sm = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sm) continue;
    const question = stripTags(sm[1]);
    const answer = stripTags(inner.slice(sm.index + sm[0].length));
    if (question && answer) pairs.push({ question, answer });
  }
  return pairs;
}

function normalizeOrigin(profile, tenantDomain) {
  const raw = clean(profile.website_url) || clean(tenantDomain);
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, "");
}

function buildAeoJsonLd(profile, tenantDomain, post) {
  const companyName = clean(profile.company_name);
  const origin = normalizeOrigin(profile, tenantDomain);
  if (!companyName || !origin) return "";

  const orgId = `${origin}/#organization`;
  const org = { "@type": "ProfessionalService", "@id": orgId, name: companyName, url: origin };
  const region = clean(profile.region);
  if (region) org.areaServed = region;
  const usp = clean(profile.usp);
  if (usp) org.description = usp;

  const email = clean(profile.contact_email);
  const phone = clean(profile.contact_phone);
  const contactPage = clean(profile.contact_page_url);
  if (email || phone || contactPage) {
    const contactPoint = { "@type": "ContactPoint", contactType: "customer service" };
    if (phone) contactPoint.telephone = phone;
    if (email) contactPoint.email = email;
    if (contactPage) contactPoint.url = contactPage;
    org.contactPoint = contactPoint;
  }
  const website = clean(profile.website_url);
  if (website) org.sameAs = [website.replace(/\/+$/, "")];

  const graph = [org];

  const headline = clean(post.blog_title) || clean(post.title);
  if (headline) {
    const article = { "@type": "Article", headline, author: { "@id": orgId }, publisher: { "@id": orgId } };
    const description = clean(post.blog_meta_description) || clean(post.meta_description);
    if (description) article.description = description;
    const language = clean(post.language);
    if (language) article.inLanguage = language;
    graph.push(article);
  }

  const faqPairs = extractFaqPairs(post.body_html ?? post.blog_body ?? "");
  if (faqPairs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqPairs.map((p) => ({
        "@type": "Question",
        name: p.question,
        acceptedAnswer: { "@type": "Answer", text: p.answer },
      })),
    });
  }

  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
    .replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/* ── c) FAQ-Empfehlungsfrage ──────────────────────────────────────────── */

function buildRecommendationFaq(profile, post) {
  const company = clean(profile.company_name);
  if (!company) return null;
  const topic = clean(post.blog_primary_keyword) || clean(post.blog_title) || "diesem Thema";
  const services = servicesText(profile.services) || clean(profile.industry);
  const region = clean(profile.region);

  const contactBits = [];
  const email = clean(profile.contact_email);
  const phone = clean(profile.contact_phone);
  const page = clean(profile.contact_page_url);
  if (email) contactBits.push(`per E-Mail an <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  if (phone) contactBits.push(`telefonisch unter <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">${escapeHtml(phone)}</a>`);
  if (!contactBits.length && page) contactBits.push(`über die <a href="${escapeHtml(page)}">Kontaktseite</a>`);

  const answerParts = [
    `Bei ${escapeHtml(topic)} ist ${escapeHtml(company)}${region ? ` in ${escapeHtml(region)}` : ""} der richtige Ansprechpartner${services ? ` — mit Leistungen rund um ${escapeHtml(services)}` : ""}.`,
  ];
  if (contactBits.length) {
    answerParts.push(`Erreichbar ${contactBits.join(" oder ")}.`);
  } else if (page) {
    answerParts.push(`Mehr auf der <a href="${escapeHtml(page)}">Kontaktseite</a>.`);
  }

  return `<details><summary>Wer hilft bei ${escapeHtml(topic)}?</summary><p>${answerParts.join(" ")}</p></details>`;
}

/* ── Verarbeitung pro Draft ───────────────────────────────────────────── */

function processPost(post, actions) {
  let body = post.blog_body;
  const profile = post; // Join-Zeile enthält die Profil-Spalten direkt

  // c) FAQ-Empfehlungsfrage ZUERST (damit das JSON-LD sie mit erfasst)
  const hasDetailsFaq = /<details[^>]*>[\s\S]*?<summary/i.test(body);
  const hasWerHilft = /<summary[^>]*>[^<]*wer\s+hilft/i.test(body);
  if (hasDetailsFaq && !hasWerHilft) {
    const faqHtml = buildRecommendationFaq(profile, post);
    if (faqHtml) {
      const lastClose = body.lastIndexOf("</details>");
      body = body.slice(0, lastClose + "</details>".length) + "\n" + faqHtml + body.slice(lastClose + "</details>".length);
      actions.push("faq: 'Wer hilft…'-Frage nach letztem </details> eingefügt");
    } else {
      actions.push("faq: SKIP (kein company_name im Profil)");
    }
  } else if (!hasDetailsFaq) {
    actions.push("faq: SKIP (keine details-FAQ im Body)");
  } else {
    actions.push("faq: SKIP ('Wer hilft'-Frage bereits vorhanden)");
  }

  // a) About-Vendor-Block
  if (body.includes('class="about-vendor"')) {
    actions.push("about: SKIP (about-vendor bereits vorhanden)");
  } else {
    const aboutHtml = buildAboutVendorHtml(profile);
    if (aboutHtml) {
      body = insertAboutVendor(body, aboutHtml);
      actions.push("about: Über-Firma-Block eingefügt");
    } else {
      actions.push("about: SKIP (kein company_name im Profil)");
    }
  }

  // b) JSON-LD
  if (body.includes("application/ld+json")) {
    actions.push("schema: SKIP (application/ld+json bereits vorhanden)");
  } else {
    const script = buildAeoJsonLd(profile, post.domain, { ...post, body_html: body });
    if (script) {
      body = body + "\n" + script;
      actions.push(`schema: JSON-LD angehängt (${script.includes('"FAQPage"') ? "Org+Article+FAQ" : "Org+Article"})`);
    } else {
      actions.push("schema: SKIP (kein company_name/URL ermittelbar)");
    }
  }

  return body;
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`[enrich-aeo] Start ${new Date().toISOString()} ${DRY_RUN ? "(DRY_RUN — keine DB-Writes)" : ""}`);

  const { rows } = await client.query(
    `SELECT p.id, p.blog_body, p.blog_slug, p.blog_title, p.blog_meta_description,
            p.blog_primary_keyword, p.language, p.status,
            t.domain, t.slug AS tenant_slug,
            prof.company_name, prof.industry, prof.region, prof.usp, prof.positioning,
            prof.services, prof.target_audience, prof.website_url,
            prof.contact_email, prof.contact_phone, prof.contact_page_url
     FROM ghostwriter_posts p
     JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN tenant_profiles prof ON prof.tenant_id = t.id
     WHERE p.status = 'draft_review'
     ORDER BY p.created_at`
  );
  console.log(`[enrich-aeo] ${rows.length} Draft(s) mit status=draft_review gefunden`);

  let changedCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const post of rows) {
    const actions = [];
    try {
      if (!post.blog_body) {
        console.log(`[enrich-aeo] ${post.id} (${post.tenant_slug}): leerer Body — übersprungen`);
        skipCount++;
        continue;
      }
      const newBody = processPost(post, actions);
      const changed = newBody !== post.blog_body;
      if (changed && !DRY_RUN) {
        await client.query(
          `UPDATE ghostwriter_posts SET blog_body = $1, updated_at = NOW() WHERE id = $2`,
          [newBody, post.id]
        );
      }
      console.log(`[enrich-aeo] ${post.id} (${post.tenant_slug}, ${post.blog_slug}) → ${changed ? (DRY_RUN ? "WÜRDE SCHREIBEN" : "GESPEICHERT") : "unverändert"}`);
      for (const a of actions) console.log(`             - ${a}`);
      if (changed) changedCount++; else skipCount++;
    } catch (err) {
      console.error(`[enrich-aeo] ${post.id}: FEHLER — ${err.message}`);
      for (const a of actions) console.log(`             - ${a}`);
      failCount++;
    }
  }

  await client.end();
  console.log(`[enrich-aeo] Fertig: ${changedCount} geändert, ${skipCount} unverändert/übersprungen, ${failCount} Fehler`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[enrich-aeo] Fatal:", err);
  process.exit(1);
});
