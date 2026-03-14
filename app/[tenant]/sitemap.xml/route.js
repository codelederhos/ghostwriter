import { query } from "@/lib/db";

export async function GET(req, { params }) {
  const { tenant } = params;

  const { rows: [t] } = await query(
    "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) return new Response("Not found", { status: 404 });

  const { rows: posts } = await query(
    `SELECT blog_slug, language, published_at FROM ghostwriter_posts
     WHERE tenant_id = $1 AND status = 'published'
     ORDER BY published_at DESC`,
    [t.id]
  );

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  const urls = posts.map((p) => `
  <url>
    <loc>${baseUrl}/${tenant}/${p.language}/blog/${p.blog_slug}</loc>
    <lastmod>${new Date(p.published_at).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
  </url>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
