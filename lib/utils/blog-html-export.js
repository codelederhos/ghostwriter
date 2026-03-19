/**
 * Blog HTML Export Utility
 * Generiert eine vollständige, standalone HTML-Seite aus einem ghostwriter_post.
 * Enthält: alle SEO-Meta-Tags, Schema.org JSON-LD (BlogPosting + FAQPage),
 * Canonical, hreflang, inline Blog-CSS, den Artikel-Content.
 */

/** Extract FAQ schema from <details><summary> blocks */
function extractFAQSchema(html) {
  if (!html) return null;
  const matches = [...html.matchAll(/<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)];
  if (!matches.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: matches.map((m) => ({
      "@type": "Question",
      name: m[1].replace(/<[^>]+>/g, "").trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: m[2].replace(/<[^>]+>/g, "").trim().slice(0, 500),
      },
    })),
  };
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Minimales Blog-CSS (plain CSS, kein Tailwind — für standalone Export)
const BLOG_CSS = `
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 0; }
.gw-article { max-width: 740px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
.gw-header { border-bottom: 1px solid #e5e7eb; padding: 1rem 1.5rem; margin-bottom: 0; }
.gw-header a { font-weight: 700; font-size: 1.1rem; text-decoration: none; color: #1a1a1a; }
.gw-meta { font-size: 0.85rem; color: #6b7280; margin-bottom: 1rem; }
h1 { font-size: 2rem; font-weight: 800; line-height: 1.2; margin: 0 0 0.75rem; }
.gw-lead { font-size: 1.1rem; color: #4b5563; margin-bottom: 2rem; }
.gw-hero { border-radius: 12px; overflow: hidden; margin-bottom: 2rem; aspect-ratio: 16/9; }
.gw-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.blog-prose { font-size: 1rem; line-height: 1.75; color: #374151; }
.blog-prose h2 { font-size: 1.3rem; font-weight: 700; margin: 2rem 0 0.75rem; color: #111827; }
.blog-prose h3 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; color: #111827; }
.blog-prose p { margin-bottom: 1rem; }
.blog-prose ul, .blog-prose ol { margin-bottom: 1rem; padding-left: 1.5rem; }
.blog-prose li { margin-bottom: 0.25rem; }
.blog-prose a { color: #4f46e5; text-decoration: underline; }
.blog-prose strong { font-weight: 600; }
.blog-prose details { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.5rem; overflow: hidden; }
.blog-prose details summary { padding: 0.75rem 1rem; cursor: pointer; font-weight: 500; list-style: none; }
.blog-prose details summary::after { content: "+"; float: right; font-weight: 700; color: #6b7280; }
.blog-prose details[open] summary::after { content: "−"; }
.blog-prose details > p, .blog-prose details > div { padding: 0.75rem 1rem; }
.blog-prose .callout { position: relative; padding: 1rem 1rem 1rem 2.75rem; border-radius: 8px; margin: 1.25rem 0; font-size: 0.95rem; }
.blog-prose .callout::before { position: absolute; left: 0.85rem; top: 1rem; }
.blog-prose .callout--tip { background: #f0fdf4; border: 1px solid #bbf7d0; }
.blog-prose .callout--tip::before { content: "💡"; }
.blog-prose .callout--info { background: #eff6ff; border: 1px solid #bfdbfe; }
.blog-prose .callout--info::before { content: "ℹ️"; }
.blog-prose .callout--warning { background: #fffbeb; border: 1px solid #fde68a; }
.blog-prose .callout--warning::before { content: "⚠️"; }
.blog-prose .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; margin: 1.5rem 0; }
@media (min-width: 600px) { .blog-prose .stat-grid { grid-template-columns: repeat(4, 1fr); } }
.blog-prose .stat-grid__item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1rem 0.75rem; text-align: center; }
.blog-prose .stat-grid__num { font-size: 1.4rem; font-weight: 800; color: #4f46e5; }
.blog-prose .stat-grid__label { font-size: 0.78rem; color: #6b7280; margin-top: 0.25rem; }
.blog-prose .compare-block { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin: 1.5rem 0; }
.blog-prose .compare-block__row { display: grid; grid-template-columns: 1fr 1fr 1fr; }
.blog-prose .compare-block__row > div { padding: 0.6rem 0.75rem; font-size: 0.88rem; border-right: 1px solid #e5e7eb; }
.blog-prose .compare-block__header { background: #1e1b4b; color: #fff; font-weight: 600; }
.blog-prose .compare-block__row:nth-child(even):not(.compare-block__header) { background: #f9fafb; }
.blog-prose .compare-block__neg { color: #dc2626; }
.blog-prose .compare-block__pos { color: #16a34a; font-weight: 600; }
.blog-prose .process-steps { list-style: none; padding: 0; margin: 1.5rem 0; counter-reset: steps; }
.blog-prose .process-steps li { position: relative; padding-left: 3.5rem; margin-bottom: 1rem; counter-increment: steps; min-height: 2.75rem; }
.blog-prose .process-steps li::before { content: counter(steps); position: absolute; left: 0; top: 0; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
.blog-prose .check-list, .blog-prose .cross-list { list-style: none; padding: 0; margin: 1rem 0; }
.blog-prose .check-list li, .blog-prose .cross-list li { padding-left: 1.75rem; margin-bottom: 0.4rem; position: relative; }
.blog-prose .check-list li::before { content: "✓"; position: absolute; left: 0; color: #16a34a; font-weight: 700; }
.blog-prose .cross-list li::before { content: "✗"; position: absolute; left: 0; color: #dc2626; font-weight: 700; }
.blog-prose .highlight-quote { border-left: 4px solid #4f46e5; background: #f5f3ff; padding: 1rem 1.25rem 1rem 2.5rem; border-radius: 0 8px 8px 0; font-size: 1.05rem; font-style: italic; color: #1e1b4b; position: relative; margin: 1.5rem 0; }
.blog-prose .highlight-quote::before { content: "\\""; position: absolute; left: 0.5rem; top: -0.25rem; font-size: 3rem; color: #a5b4fc; line-height: 1; }
.blog-prose .source-pill { display: inline-block; padding: 0 0.4rem; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; font-size: 0.75rem; color: #2563eb; text-decoration: none; margin: 0 0.1rem; }
.blog-prose .sources-list { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; }
.blog-prose .sources-list h2 { font-size: 1rem; color: #6b7280; }
.blog-prose .sources-list ol { font-size: 0.85rem; }
.blog-prose .sources-list a { color: #4f46e5; }
.blog-prose figure.article-figure { margin: 2rem 0; border-radius: 10px; overflow: hidden; }
.blog-prose figure.article-figure img { width: 100%; height: auto; display: block; }
.blog-prose table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
.blog-prose table th { background: #f3f4f6; padding: 0.6rem; text-align: left; border: 1px solid #e5e7eb; font-weight: 600; }
.blog-prose table td { padding: 0.6rem; border: 1px solid #e5e7eb; }
.gw-lang-switcher { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; }
.gw-lang-switcher p { font-size: 0.85rem; color: #6b7280; margin-bottom: 0.5rem; }
.gw-lang-link { display: inline-block; padding: 0.25rem 0.75rem; border: 1px solid #e5e7eb; border-radius: 999px; font-size: 0.85rem; text-decoration: none; color: #374151; margin-right: 0.5rem; }
.gw-test-banner { background: #fef3c7; border-bottom: 2px solid #f59e0b; padding: 0.75rem 1.5rem; text-align: center; font-size: 0.875rem; font-weight: 500; color: #92400e; }
.internal-link { color: #4f46e5; text-decoration: underline; text-decoration-style: dotted; }
`;

/**
 * Generates a complete standalone HTML page for a post.
 * @param {object} post - ghostwriter_posts record
 * @param {object} profile - tenant_profiles record
 * @param {object} tenant - tenants record
 * @param {Array} alternates - hreflang alternates [{ language, blog_slug }]
 * @param {string} baseUrl
 * @returns {string} Complete HTML page
 */
export function generateBlogHtml(post, profile, tenant, alternates = [], baseUrl = "") {
  const canonicalUrl = `${baseUrl}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;
  const companyName = profile?.company_name || tenant.name;

  // Schema.org BlogPosting
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.blog_title,
    description: post.blog_meta_description,
    image: post.image_url ? { "@type": "ImageObject", url: post.image_url, width: 1536, height: 864 } : undefined,
    datePublished: post.published_at || post.created_at,
    dateModified: post.updated_at || post.published_at || post.created_at,
    author: { "@type": "Organization", name: companyName, url: profile?.website_url },
    publisher: { "@type": "Organization", name: companyName, url: profile?.website_url },
    inLanguage: post.language,
    url: canonicalUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
  };

  const faqSchema = extractFAQSchema(post.blog_body);

  // Lesedauer
  const wordCount = post.blog_body ? post.blog_body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length : 0;
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const pubDate = new Date(post.published_at || post.created_at).toLocaleDateString(post.language, {
    year: "numeric", month: "long", day: "numeric",
  });

  const hreflangLinks = alternates.map(a =>
    `  <link rel="alternate" hrefLang="${escapeHtml(a.language)}" href="${escapeHtml(`${baseUrl}/${tenant.slug}/${a.language}/blog/${a.blog_slug}`)}" />`
  ).join("\n");

  const langSwitcher = alternates.filter(a => a.language !== post.language).length > 0
    ? `<div class="gw-lang-switcher">
        <p>Auch verfügbar in:</p>
        ${alternates.filter(a => a.language !== post.language).map(a =>
          `<a class="gw-lang-link" href="${escapeHtml(`${baseUrl}/${tenant.slug}/${a.language}/blog/${a.blog_slug}`)}">${escapeHtml(a.language.toUpperCase())}</a>`
        ).join("")}
      </div>`
    : "";

  const testBanner = post.is_test
    ? `<div class="gw-test-banner">⚠️ Test-Post — wird bei Export zu vollwertigem Artikel umgewandelt</div>`
    : "";

  const preloadHero = post.image_url
    ? `  <link rel="preload" as="image" href="${escapeHtml(post.image_url)}" />`
    : "";

  const heroImage = post.image_url
    ? `<div class="gw-hero"><img src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.image_alt_text || post.blog_title)}" width="1536" height="864" /></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(post.language)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(post.blog_title_tag || post.blog_title)}</title>
  <meta name="description" content="${escapeHtml(post.blog_meta_description || "")}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  ${post.is_test ? '<meta name="robots" content="noindex, nofollow" />' : ""}
${hreflangLinks}
${preloadHero}
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(post.blog_title)}" />
  <meta property="og:description" content="${escapeHtml(post.blog_meta_description || "")}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${post.image_url ? `<meta property="og:image" content="${escapeHtml(post.image_url)}" /><meta property="og:image:width" content="1536" /><meta property="og:image:height" content="864" />` : ""}
  <!-- Schema.org -->
  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  ${faqSchema ? `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : ""}
  <!-- Blog CSS -->
  <style>${BLOG_CSS}</style>
</head>
<body>
  <header class="gw-header">
    <a href="${escapeHtml(`${baseUrl}/${tenant.slug}/${post.language}/blog`)}">${escapeHtml(companyName)}</a>
  </header>
  ${testBanner}
  <main class="gw-article">
    <div class="gw-meta">${escapeHtml(post.category || "")} &middot; ${escapeHtml(pubDate)} &middot; ${readingMinutes} min Lesezeit</div>
    <h1>${escapeHtml(post.blog_title)}</h1>
    ${post.blog_meta_description ? `<p class="gw-lead">${escapeHtml(post.blog_meta_description)}</p>` : ""}
    ${heroImage}
    <div class="blog-prose">${post.blog_body || ""}</div>
    ${langSwitcher}
  </main>
  <!-- Generated by Ghostwriter — ghostwriter.code-lederhos.de -->
</body>
</html>`;
}
