import { query } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }) {
  const { tenant, lang, slug } = params;
  const { rows: [t] } = await query("SELECT id FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return {};
  const { rows: [post] } = await query(
    "SELECT blog_title, blog_title_tag, blog_meta_description, image_url FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status = 'published'",
    [t.id, lang, slug]
  );
  if (!post) return {};

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  return {
    title: post.blog_title_tag || post.blog_title,
    description: post.blog_meta_description,
    openGraph: {
      title: post.blog_title,
      description: post.blog_meta_description,
      images: post.image_url ? [{ url: post.image_url, width: 1200, height: 900 }] : [],
      type: "article",
      url: `${baseUrl}/${tenant}/${lang}/blog/${slug}`,
    },
  };
}

export default async function BlogPostPage({ params }) {
  const { tenant, lang, slug } = params;

  const { rows: [t] } = await query(
    "SELECT id, name, slug, domain FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenant]
  );
  if (!t) notFound();

  const { rows: [post] } = await query(
    "SELECT * FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status = 'published'",
    [t.id, lang, slug]
  );
  if (!post) notFound();

  const { rows: [profile] } = await query(
    "SELECT * FROM tenant_profiles WHERE tenant_id = $1", [t.id]
  );

  // hreflang alternates
  const { rows: alternates } = await query(
    `SELECT language, blog_slug FROM ghostwriter_posts
     WHERE tenant_id = $1 AND category = $2 AND angle = $3 AND season = $4
       AND status = 'published'`,
    [t.id, post.category, post.angle, post.season]
  );

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  // Schema.org structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.blog_title,
    description: post.blog_meta_description,
    image: post.image_url,
    datePublished: post.published_at,
    dateCreated: post.created_at,
    author: {
      "@type": "Organization",
      name: profile?.company_name || t.name,
      url: profile?.website_url,
    },
    publisher: {
      "@type": "Organization",
      name: profile?.company_name || t.name,
    },
    inLanguage: lang,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* hreflang */}
      {alternates.map((alt) => (
        <link
          key={alt.language}
          rel="alternate"
          hrefLang={alt.language}
          href={`${baseUrl}/${tenant}/${alt.language}/blog/${alt.blog_slug}`}
        />
      ))}

      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border bg-white">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href={`/${tenant}/${lang}/blog`} className="font-bold text-lg">
              {t.name}
            </Link>
            <Link href={`/${tenant}/${lang}/blog`} className="text-sm text-muted-foreground hover:text-foreground">
              Alle Artikel
            </Link>
          </div>
        </header>

        {/* Article */}
        <article className="max-w-3xl mx-auto px-6 py-12">
          {/* Meta */}
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-2">
              {post.category} &middot; {new Date(post.published_at).toLocaleDateString(lang)}
            </p>
            <h1 className="text-3xl font-bold leading-tight mb-3">{post.blog_title}</h1>
            {post.blog_meta_description && (
              <p className="text-lg text-muted-foreground">{post.blog_meta_description}</p>
            )}
          </div>

          {/* Image */}
          {post.image_url && (
            <div className="rounded-xl overflow-hidden mb-8 aspect-[4/3]">
              <img
                src={post.image_url}
                alt={post.image_alt_text || post.blog_title}
                className="w-full h-full object-cover"
                width={1200}
                height={900}
              />
            </div>
          )}

          {/* Body */}
          <div
            className="blog-prose"
            dangerouslySetInnerHTML={{ __html: post.blog_body }}
          />

          {/* Language alternates */}
          {alternates.length > 1 && (
            <div className="mt-12 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground mb-2">Auch verfügbar in:</p>
              <div className="flex gap-2">
                {alternates
                  .filter((a) => a.language !== lang)
                  .map((alt) => (
                    <Link
                      key={alt.language}
                      href={`/${tenant}/${alt.language}/blog/${alt.blog_slug}`}
                      className="px-3 py-1 rounded-full border border-border text-sm hover:bg-muted transition-colors"
                    >
                      {alt.language.toUpperCase()}
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </article>
      </div>
    </>
  );
}
