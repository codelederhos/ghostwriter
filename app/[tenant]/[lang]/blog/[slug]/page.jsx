import { query } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import BlogWidgets from "./BlogWidgets";

export async function generateMetadata({ params }) {
  const { tenant, lang, slug } = params;
  const { rows: [t] } = await query("SELECT id FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return {};
  const { rows: [post] } = await query(
    "SELECT blog_title, blog_title_tag, blog_meta_description, image_url FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status IN ('published', 'draft')",
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
    "SELECT *, image_prompt_1 FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3 AND status IN ('published', 'draft')",
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

        {/* Draft-Banner */}
        {post.status === "draft" && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-center">
            <span className="text-sm font-medium text-amber-800">Vorschau — dieser Artikel ist noch nicht veröffentlicht</span>
          </div>
        )}

        {/* Article */}
        <article className="max-w-3xl mx-auto px-6 py-12">
          {/* Meta */}
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-2">
              {post.category} &middot; {new Date(post.published_at || post.created_at).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" })}
            </p>
            <h1 className="text-3xl font-bold leading-tight mb-3">{post.blog_title}</h1>
            {post.blog_meta_description && (
              <p className="text-lg text-muted-foreground">{post.blog_meta_description}</p>
            )}
          </div>

          {/* Image */}
          {post.image_url ? (
            <div className="rounded-xl overflow-hidden mb-8 aspect-[16/9]">
              <img
                src={post.image_url}
                alt={post.image_alt_text || post.blog_title}
                className="w-full h-full object-cover"
                width={1536}
                height={864}
              />
            </div>
          ) : (
            <div
              className="rounded-xl overflow-hidden mb-8 aspect-[16/9] bg-muted animate-pulse flex items-center justify-center"
              role="img"
              aria-label={post.image_alt_text || post.blog_title}
              data-prompt={post.image_prompt_1 || ""}
              data-post-id={post.id}
              style={{ minHeight: "200px" }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-muted-foreground/30">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="12" cy="12" r="3.5" />
                <path d="M7 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
              </svg>
            </div>
          )}

          {/* Body */}
          <div
            className="blog-prose"
            dangerouslySetInnerHTML={{ __html: post.blog_body }}
          />
          <BlogWidgets />

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
