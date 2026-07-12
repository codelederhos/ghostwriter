export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/sitemap/{tenant}?format=json|xml
 * Gibt alle published SEO-Pages als Sitemap zurück
 */
export async function GET(req, { params }) {
  const { tenant } = params;
  const format = new URL(req.url).searchParams.get("format") || "json";

  const { rows: [t] } = await query(
    "SELECT id, domain FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const baseUrl = t.domain ? `https://${t.domain}` : "";

  const { rows: pages } = await query(
    `SELECT
       p.slug, p.lang, p.priority, p.changefreq, p.published_at, p.page_type_id, p.location_id,
       tr.lang_de, tr.lang_ro, tr.lang_en,
       de_p.slug AS slug_de, ro_p.slug AS slug_ro, en_p.slug AS slug_en
     FROM seo_pages p
     LEFT JOIN seo_page_translations tr
       ON tr.page_type_id = p.page_type_id AND tr.location_id = p.location_id
     LEFT JOIN seo_pages de_p ON de_p.id = tr.lang_de
     LEFT JOIN seo_pages ro_p ON ro_p.id = tr.lang_ro
     LEFT JOIN seo_pages en_p ON en_p.id = tr.lang_en
     WHERE p.tenant_id = $1 AND p.status = 'published'
     ORDER BY p.priority DESC, p.slug`,
    [t.id]
  );

  if (format === "xml") {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ];
    for (const p of pages) {
      const loc = `${baseUrl}/${p.slug}/`;
      const lastmod = p.published_at ? new Date(p.published_at).toISOString().split("T")[0] : "";
      lines.push("  <url>");
      lines.push(`    <loc>${loc}</loc>`);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      lines.push(`    <changefreq>${p.changefreq}</changefreq>`);
      lines.push(`    <priority>${p.priority}</priority>`);
      if (p.slug_de) lines.push(`    <xhtml:link rel="alternate" hreflang="de-DE" href="${baseUrl}/${p.slug_de}/" />`);
      if (p.slug_ro) lines.push(`    <xhtml:link rel="alternate" hreflang="ro-RO" href="${baseUrl}/${p.slug_ro}/" />`);
      if (p.slug_de) lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/${p.slug_de}/" />`);
      lines.push("  </url>");
    }
    lines.push("</urlset>");
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  // JSON format
  return NextResponse.json({
    tenant,
    count: pages.length,
    pages: pages.map(p => ({
      slug: p.slug,
      lang: p.lang,
      url: `${baseUrl}/${p.slug}/`,
      priority: p.priority,
      changefreq: p.changefreq,
      lastmod: p.published_at ? new Date(p.published_at).toISOString().split("T")[0] : null,
    })),
  });
}
