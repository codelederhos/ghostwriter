/**
 * Öffentliche Draft-Vorschau per Preview-Token.
 * Zugriff nur mit gültigem Token (sha256-Hash-Vergleich in lib/review/publish.js).
 * Rendering wie die echte Tenant-Blog-Seite (Hero + blog-prose + BlogWidgets)
 * + Reader-UX (Scroll-Reveal, Floating TOC) + Draft-Aktionen (Sektion neu
 * generieren, Freigeben) für Posts im Status draft_review.
 * ?static=1 → Screenshot-Modus ohne Animationen (Bilder eager, Counter sofort).
 */

import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { findPostByReviewToken } from "@/lib/review/publish";
import { injectH2Ids } from "@/lib/blog/heading-ids";
import { splitSections } from "@/app/api/admin/drafts/_lib/workspace";
import BlogWidgets from "@/app/[tenant]/[lang]/blog/[slug]/BlogWidgets";
import CopyButton from "./CopyButton";
import ReaderExperience from "./ReaderExperience";
import DraftActions from "./DraftActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Artikel-Vorschau — Ghostwriter",
  robots: { index: false, follow: false },
};

function fmtDatumDE(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function parseQa(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { legacyIssues: value };
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? { legacyIssues: parsed } : parsed;
  } catch {
    return null;
  }
}

function gateLabel(status) {
  if (status === "ready_for_approval") return "Bereit zur Freigabe";
  if (status === "review") return "Review empfohlen";
  if (status === "needs_revision") return "Nacharbeit nötig";
  return "Offen";
}

function gateBadgeClass(status) {
  if (status === "ready_for_approval") return "badge badge-success";
  if (status === "needs_revision") return "badge badge-error";
  return "badge badge-warning";
}

function scoreBadgeClass(score) {
  if (score == null) return "badge badge-neutral";
  if (score >= 8) return "badge badge-success";
  if (score >= 5) return "badge badge-warning";
  return "badge badge-error";
}

export default async function ReviewPreviewPage({ params, searchParams }) {
  let token = params?.token || "";
  try {
    token = decodeURIComponent(token);
  } catch {
    // Token unverändert lassen — Hash-Vergleich schlägt dann einfach fehl
  }

  const post = await findPostByReviewToken("preview", token);
  if (!post) notFound();

  const { rows: [tenant] } = await query(
    "SELECT id, name, slug, domain FROM tenants WHERE id = $1",
    [post.tenant_id]
  );

  // Screenshot-Modus: keine Animationen, Bilder eager, keine Draft-Buttons
  const staticMode = searchParams?.static === "1";
  const showActions = post.status === "draft_review" && !staticMode;

  // Sektions-Metadaten DIREKT aus splitSections — damit sind die Indizes der
  // "Neu generieren"-Buttons garantiert konsistent mit der API (replaceSection).
  const sectionsMeta = splitSections(post.blog_body || "").map((s) => ({
    idx: s.idx,
    title: s.title,
    startsWithH2: /^<h2[\s>]/i.test(s.html),
  }));

  // h2-Anker-IDs für den Floating-TOC serverseitig injizieren (nicht persistiert)
  // Screenshot-Modus: auch Body-Bilder (Chart, Inline-Figures) eager laden
  let bodyHtml = injectH2Ids(post.blog_body || "");
  if (staticMode) bodyHtml = bodyHtml.replace(/loading="lazy"/g, 'loading="eager"');

  const qa = parseQa(post.qa_issues);
  const gateStatus = qa?.gate_status || qa?.status || null;
  const qaScore = post.qa_score != null ? Number(post.qa_score) : (qa?.score != null ? Number(qa.score) : null);
  const checks = Array.isArray(qa?.checks) ? qa.checks : [];
  const failedChecks = checks.filter((c) => !c.passed);
  const legacyIssues = Array.isArray(qa?.legacyIssues) ? qa.legacyIssues : [];

  const wordCount = post.blog_body
    ? post.blog_body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length
    : 0;
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const isPublished = post.status === "published";
  const isRejected = post.status === "rejected";

  // Social- und GBP-Texte für die Prüfstrecke (werden später autonom gepostet)
  let social = null;
  if (post.social_text) {
    if (typeof post.social_text === "object") social = post.social_text;
    else { try { social = JSON.parse(post.social_text); } catch { social = null; } }
  }
  // CTA zeigt IMMER auf die konfigurierte Tenant-Domain, nie auf Ghostwriter
  const blogUrlForCta = tenant?.domain
    ? `https://${tenant.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/blog/${post.blog_slug}`
    : (post.blog_url || `${process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de"}/${tenant?.slug}/${post.language}/blog/${post.blog_slug}`);
  const postImage = post.image_url || null;
  const socialCards = [
    { key: "linkedin", label: "LinkedIn", text: social?.linkedin },
    { key: "facebook", label: "Facebook", text: social?.facebook },
    { key: "instagram", label: "Instagram", text: social?.instagram },
  ].filter((c) => c.text && String(c.text).trim());

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-lg break-words">{tenant?.name || "Ghostwriter"}</span>
          <span className="badge badge-neutral">Vorschau</span>
        </div>
      </header>

      {/* Status-Banner */}
      {isPublished ? (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2.5 text-center">
          <span className="text-sm font-medium text-emerald-800">
            Dieser Artikel ist bereits veröffentlicht.{" "}
            {post.blog_url && (
              <a href={post.blog_url} className="underline underline-offset-2">Zum Artikel</a>
            )}
          </span>
        </div>
      ) : isRejected ? (
        <div className="bg-gray-50 border-b border-border px-6 py-2.5 text-center">
          <span className="text-sm font-medium text-muted-foreground">
            Dieser Entwurf wurde verworfen und wird nicht veröffentlicht.
          </span>
        </div>
      ) : (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-center">
          <span className="text-sm font-medium text-amber-800">
            Vorschau — dieser Artikel ist noch nicht veröffentlicht
          </span>
        </div>
      )}

      {/* Article — Rendering wie die echte Blog-Seite */}
      <article className="max-w-3xl mx-auto px-6 py-12 min-w-0">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground mb-2 flex flex-wrap items-center gap-2">
            {post.category && <span>{post.category}</span>}
            {post.category && <span className="text-muted-foreground/40">&middot;</span>}
            <span>{fmtDatumDE(post.created_at)}</span>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>{readingMinutes} min Lesezeit</span>
            {post.language && (
              <>
                <span className="text-muted-foreground/40">&middot;</span>
                <span className="uppercase tracking-wider">{post.language}</span>
              </>
            )}
          </p>
          <h1 className="text-3xl font-bold leading-tight mb-3 break-words">{post.blog_title}</h1>
          {post.blog_meta_description && (
            <p className="text-lg text-muted-foreground">{post.blog_meta_description}</p>
          )}
        </div>

        {/* Hero-Bild */}
        {post.image_url ? (
          <div className="rounded-xl overflow-hidden mb-8 aspect-[16/9]">
            <img
              src={post.image_url}
              alt={post.image_alt_text || post.blog_title}
              className="w-full h-full object-cover"
              width={1536}
              height={864}
              fetchPriority="high"
            />
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden mb-8 aspect-[16/9] bg-muted flex items-center justify-center w-full max-w-full"
            role="img"
            aria-label={post.image_alt_text || post.blog_title}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-muted-foreground/30">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="12" cy="12" r="3.5" />
              <path d="M7 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
            </svg>
          </div>
        )}

        {/* Body */}
        <div className="blog-prose" dangerouslySetInnerHTML={{ __html: bodyHtml || "<p>Noch kein Artikeltext vorhanden.</p>" }} />
        <ReaderExperience mode="preview" staticMode={staticMode} raised={showActions} />
        <BlogWidgets staticMode={staticMode} />
        {showActions && (
          <DraftActions
            token={token}
            domain={tenant?.domain ? String(tenant.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "") : null}
            sections={sectionsMeta}
          />
        )}

        {/* Zweites Artikelbild — nur wenn es nicht schon im Body eingebettet ist */}
        {post.image_url_2 && !(post.blog_body || "").includes(post.image_url_2) && (
          <figure className="mt-8 mb-0">
            <div className="rounded-xl overflow-hidden aspect-[16/9]">
              <img
                src={post.image_url_2}
                alt={post.image_alt_text_2 || post.blog_title}
                className="w-full h-full object-cover"
                loading={staticMode ? "eager" : "lazy"}
              />
            </div>
            {post.image_alt_text_2 && (
              <figcaption className="text-xs text-muted-foreground mt-2">{post.image_alt_text_2}</figcaption>
            )}
          </figure>
        )}

        {/* Social-Posts — Prüfstrecke vor autonomem Posting */}
        {(socialCards.length > 0 || post.gbp_text) && (
          <section className="mt-12 min-w-0">
            <h2 className="text-base font-semibold mb-3">Social-Posts zur Prüfung</h2>
            <div className="space-y-4">
              {socialCards.map((card) => (
                <div key={card.key} className="border border-border rounded-xl bg-card p-5 min-w-0">
                  {/* Card-Header: eine Zeile — Label+Badge links (wrappt), Button rechts fest */}
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm">{card.label}</span>
                      <span className="badge badge-neutral">wird erst nach Freigabe gepostet</span>
                    </div>
                    <span className="shrink-0"><CopyButton text={card.text} /></span>
                  </div>
                  {postImage && (
                    <div className="rounded-lg overflow-hidden mb-3 aspect-[16/9] max-w-md">
                      <img src={postImage} alt="Post-Bild" className="w-full h-full object-cover" loading={staticMode ? "eager" : "lazy"} />
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words mb-0">{card.text}</p>
                </div>
              ))}
              {post.gbp_text && (
                <div className="border border-border rounded-xl bg-card p-5 min-w-0">
                  {/* Card-Header: eine Zeile — Label+Badge links (wrappt), Button rechts fest */}
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm">Google Business Post</span>
                      <span className="badge badge-neutral">wird erst nach Freigabe gepostet</span>
                    </div>
                    <span className="shrink-0"><CopyButton text={post.gbp_text} /></span>
                  </div>
                  {postImage && (
                    <div className="rounded-lg overflow-hidden mb-3 aspect-[16/9] max-w-md">
                      <img src={postImage} alt="Post-Bild" className="w-full h-full object-cover" loading={staticMode ? "eager" : "lazy"} />
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words mb-3">{post.gbp_text}</p>
                  <p className="text-xs text-muted-foreground mb-0 break-words">
                    CTA-Button: <span className="font-medium">&bdquo;Mehr erfahren&ldquo;</span> &rarr; {blogUrlForCta}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* QA-Kurzinfo */}
        <section className="mt-12 border border-border rounded-xl bg-card p-5 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="text-base font-semibold mr-1">Qualitätsprüfung</h2>
            <span className={scoreBadgeClass(qaScore)}>
              QA-Score: {qaScore != null ? `${qaScore}/10` : "–"}
            </span>
            {gateStatus && <span className={gateBadgeClass(gateStatus)}>{gateLabel(gateStatus)}</span>}
          </div>

          {failedChecks.length > 0 ? (
            <ul className="space-y-2">
              {failedChecks.slice(0, 6).map((check) => (
                <li key={check.id || check.label} className="flex flex-wrap items-start gap-2 text-sm">
                  <span className={check.severity === "critical" ? "badge badge-error shrink-0" : "badge badge-warning shrink-0"}>
                    {check.severity === "critical" ? "Kritisch" : "Hinweis"}
                  </span>
                  <span className="text-muted-foreground break-words min-w-0">
                    {check.label ? `${check.label}: ` : ""}{check.message || "Review nötig"}
                  </span>
                </li>
              ))}
            </ul>
          ) : legacyIssues.length > 0 ? (
            <ul className="space-y-2">
              {legacyIssues.slice(0, 6).map((issue, idx) => (
                <li key={idx} className="flex flex-wrap items-start gap-2 text-sm">
                  <span className="badge badge-warning shrink-0">Hinweis</span>
                  <span className="text-muted-foreground break-words min-w-0">{String(issue)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground mb-0">
              Keine offenen QA-Punkte — automatische Prüfung ohne Beanstandung.
            </p>
          )}

          <p className="text-xs text-muted-foreground mt-4 mb-0">
            Diese Vorschau nutzt denselben Blog-Rahmen wie veröffentlichte Artikel.
            Die Veröffentlichung erfolgt über den grünen Freigeben-Button in dieser Vorschau
            oder den Freigabe-Link aus der Benachrichtigung.
          </p>
        </section>
      </article>
    </div>
  );
}
