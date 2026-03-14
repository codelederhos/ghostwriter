import { query } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }) {
  const { tenant, lang } = params;
  const { rows: [t] } = await query("SELECT name FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return {};
  return {
    title: `Blog — ${t.name}`,
    description: `Aktuelle Artikel und Neuigkeiten von ${t.name}`,
  };
}

export default async function BlogListPage({ params, searchParams }) {
  const { tenant, lang } = params;
  const page = parseInt(searchParams?.page || "1", 10);

  const { rows: [t] } = await query(
    "SELECT id, name, slug, domain, logo_url FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) notFound();

  const { rows: [profile] } = await query(
    "SELECT * FROM tenant_profiles WHERE tenant_id = $1", [t.id]
  );

  const limit = 12;
  const offset = (page - 1) * limit;

  const { rows: posts } = await query(
    `SELECT id, blog_title, blog_slug, blog_meta_description, image_url, image_alt_text,
            published_at, category, blog_primary_keyword
     FROM ghostwriter_posts
     WHERE tenant_id = $1 AND language = $2 AND status = 'published'
     ORDER BY published_at DESC LIMIT $3 OFFSET $4`,
    [t.id, lang, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    "SELECT COUNT(*)::int FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND status = 'published'",
    [t.id, lang]
  );
  const totalPages = Math.ceil(count / limit);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href={profile?.website_url || `/${tenant}/${lang}/blog`} className="font-bold text-lg">
            {t.name}
          </Link>
          <span className="text-sm text-muted-foreground">Blog</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Blog</h1>
        <p className="text-muted-foreground mb-10">{profile?.company_name} — Neuigkeiten und Fachartikel</p>

        {posts.length === 0 ? (
          <p className="text-muted-foreground">Noch keine Artikel veröffentlicht.</p>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/${tenant}/${lang}/blog/${post.blog_slug}`}
                className="group block rounded-xl border border-border overflow-hidden hover:shadow-md transition-shadow"
              >
                {post.image_url && (
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    <img
                      src={post.image_url}
                      alt={post.image_alt_text || post.blog_title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">
                    {post.category} &middot; {new Date(post.published_at).toLocaleDateString(lang)}
                  </p>
                  <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {post.blog_title}
                  </h2>
                  {post.blog_meta_description && (
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                      {post.blog_meta_description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-12">
            {Array.from({ length: totalPages }, (_, i) => (
              <Link
                key={i}
                href={`/${tenant}/${lang}/blog?page=${i + 1}`}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  page === i + 1
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {i + 1}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
