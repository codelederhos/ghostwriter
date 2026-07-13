/**
 * AEO-Schema-Builder: JSON-LD (@graph) für Answer Engine Optimization.
 *
 * Erzeugt ein <script type="application/ld+json"> mit:
 *  - ProfessionalService/Organization (Firma, Region, USP, Kontaktdaten)
 *  - Article (headline, author/publisher = Organization)
 *  - FAQPage (nur wenn <details>-FAQ im Body vorhanden, max. 6 Fragen)
 *
 * Das Script wird ans ENDE von body_html gehängt und überlebt so den
 * Client-Push auf die Kunden-Domains (code-lederhos.de, staned-gmbh.de, …).
 *
 * WICHTIG: Es landen NUR Felder im Output, die im Tenant-Profil tatsächlich
 * gefüllt sind — niemals erfundene Kontaktdaten, keine leeren Strings.
 */

const MAX_FAQ_ITEMS = 6;

function clean(value) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
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

function normalizeOrigin(profile, tenantDomain) {
  const raw = clean(profile?.website_url) || clean(tenantDomain);
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, "");
}

/**
 * FAQ-Paare aus <details><summary>Frage</summary>…Antwort…</details> ziehen.
 * @returns {Array<{question:string, answer:string}>}
 */
export function extractFaqPairs(bodyHtml, maxItems = MAX_FAQ_ITEMS) {
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

/**
 * Baut das JSON-LD-Script für einen Artikel.
 *
 * @param {object} profile - tenant_profiles-Zeile (company_name, region, usp,
 *   website_url, contact_email, contact_phone, contact_page_url, …)
 * @param {string|null} tenantDomain - tenants.domain (Fallback-URL)
 * @param {object} post - { title|blog_title, meta_description|blog_meta_description,
 *   body_html|blog_body, language, published_at? }
 * @returns {string} "<script type=\"application/ld+json\">…</script>" oder "" wenn
 *   keine Firma/URL ermittelbar ist.
 */
export function buildAeoJsonLd(profile, tenantDomain, post) {
  const companyName = clean(profile?.company_name);
  const origin = normalizeOrigin(profile, tenantDomain);
  if (!companyName || !origin) return "";

  const orgId = `${origin}/#organization`;
  const org = {
    "@type": "ProfessionalService",
    "@id": orgId,
    name: companyName,
    url: origin,
  };
  const region = clean(profile?.region);
  if (region) org.areaServed = region;
  const usp = clean(profile?.usp);
  if (usp) org.description = usp;

  const email = clean(profile?.contact_email);
  const phone = clean(profile?.contact_phone);
  const contactPage = clean(profile?.contact_page_url);
  if (email || phone || contactPage) {
    const contactPoint = { "@type": "ContactPoint", contactType: "customer service" };
    if (phone) contactPoint.telephone = phone;
    if (email) contactPoint.email = email;
    if (contactPage) contactPoint.url = contactPage;
    org.contactPoint = contactPoint;
  }
  const website = clean(profile?.website_url);
  if (website) org.sameAs = [website.replace(/\/+$/, "")];

  const graph = [org];

  const headline = clean(post?.blog_title) || clean(post?.title);
  if (headline) {
    const article = {
      "@type": "Article",
      headline,
      author: { "@id": orgId },
      publisher: { "@id": orgId },
    };
    const description = clean(post?.blog_meta_description) || clean(post?.meta_description);
    if (description) article.description = description;
    const language = clean(post?.language);
    if (language) article.inLanguage = language;
    const publishedAt = clean(post?.published_at);
    if (publishedAt) article.datePublished = publishedAt;
    graph.push(article);
  }

  const bodyHtml = post?.body_html ?? post?.blog_body ?? "";
  const faqPairs = extractFaqPairs(bodyHtml);
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
    .replace(/</g, "\\u003c"); // "</script>"-sicher, bleibt valides JSON
  return `<script type="application/ld+json">${json}</script>`;
}
