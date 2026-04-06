import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Public API: SEO Page-Daten für externe Sites
 * GET /api/seo/{tenant-slug}/{page-slug}?lang=de
 *
 * Response: { found, slug, lang, title, h1, meta_description, intro_html, local_html, practical_html, faq, schema_org, image_alts, internal_links, hreflang }
 */
export async function GET(req, { params }) {
  const { tenant: tenantSlug, slug: pageSlug } = params;
  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang") || "de";

  // Tenant auflösen
  const { rows: [tenant] } = await query(
    "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenantSlug]
  );
  if (!tenant) return NextResponse.json({ found: false, error: "Tenant not found" });

  // Seite laden (nur published)
  const { rows: [page] } = await query(
    `SELECT sp.*, sl.name as location_name, sl.lat, sl.lng, sl.local_spots
     FROM seo_pages sp
     JOIN seo_locations sl ON sp.location_id = sl.id
     WHERE sp.tenant_id = $1 AND sp.slug = $2 AND sp.lang = $3 AND sp.status = 'published'`,
    [tenant.id, pageSlug, lang]
  );

  if (!page) return NextResponse.json({ found: false });

  // Hreflang-Mapping laden
  const { rows: translations } = await query(
    `SELECT lang, slug FROM seo_pages
     WHERE page_type_id = $1 AND location_id = $2 AND status = 'published'`,
    [page.page_type_id, page.location_id]
  );
  const hreflang = {};
  translations.forEach(t => { hreflang[t.lang] = `/${t.slug}/`; });

  // Cache-Header: 6h
  const headers = {
    "Cache-Control": "public, max-age=21600, s-maxage=21600",
    "Access-Control-Allow-Origin": "*",
  };

  return NextResponse.json({
    found: true,
    slug: page.slug,
    lang: page.lang,
    title: page.title,
    h1: page.h1,
    meta_description: page.meta_description,
    intro_html: page.intro_html,
    local_html: page.local_html,
    practical_html: page.practical_html,
    faq: page.faq_json || [],
    schema_org: page.schema_org,
    image_alts: page.image_alts,
    internal_links: page.internal_links || [],
    hreflang,
    location: {
      name: page.location_name,
      lat: page.lat,
      lng: page.lng,
      local_spots: page.local_spots,
    },
  }, { headers });
}
