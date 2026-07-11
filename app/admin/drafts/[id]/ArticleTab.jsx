"use client";

import { useState } from "react";
import { Copy, Check, Pencil } from "lucide-react";
import BlogWidgets from "@/app/[tenant]/[lang]/blog/[slug]/BlogWidgets";
import { fmtDatumDE, readingMinutes, htmlToPlainText, copyToClipboard } from "../draftUtils";

/**
 * Artikel-Tab (Ansicht): gerendert wie die echte Tenant-Blog-Seite
 * (Meta-Zeile, Titel, Hero-Bild, blog-prose Body, BlogWidgets) + Kopieren-Buttons.
 */
export default function ArticleTab({ post, onEdit }) {
  const [copied, setCopied] = useState(null); // "html" | "text" | null
  const [copyError, setCopyError] = useState(null);

  const doCopy = async (kind) => {
    setCopyError(null);
    try {
      if (kind === "html") {
        await copyToClipboard(post.blog_body || "");
      } else {
        const text = `${post.blog_title || ""}\n\n${htmlToPlainText(post.blog_body || "")}`;
        await copyToClipboard(text.trim());
      }
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 2000);
    } catch (e) {
      setCopyError(e.message || "Kopieren fehlgeschlagen");
    }
  };

  return (
    <div className="min-w-0">
      {/* Aktionen */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {onEdit && (
          <button className="btn-primary" onClick={onEdit}>
            <Pencil size={14} /> Bearbeiten
          </button>
        )}
        <button className="btn-outline" onClick={() => doCopy("html")}>
          {copied === "html" ? <Check size={14} /> : <Copy size={14} />}
          {copied === "html" ? "HTML kopiert" : "Als HTML kopieren"}
        </button>
        <button className="btn-outline" onClick={() => doCopy("text")}>
          {copied === "text" ? <Check size={14} /> : <Copy size={14} />}
          {copied === "text" ? "Text kopiert" : "Als Text kopieren"}
        </button>
        {copyError && <span className="text-sm text-red-700">{copyError}</span>}
      </div>

      {/* Artikel wie auf der Tenant-Blog-Seite */}
      <article className="mx-auto min-w-0 max-w-3xl">
        <div className="mb-6">
          <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {post.category && (
              <>
                <span>{post.category}</span>
                <span className="text-muted-foreground/40">&middot;</span>
              </>
            )}
            <span>{fmtDatumDE(post.published_at || post.created_at)}</span>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>{readingMinutes(post.blog_body)} min Lesezeit</span>
          </p>
          <h1 className="mb-3 break-words text-3xl font-bold leading-tight">{post.blog_title}</h1>
          {post.blog_meta_description && (
            <p className="text-lg text-muted-foreground">{post.blog_meta_description}</p>
          )}
        </div>

        {post.image_url ? (
          <div className="mb-8 aspect-[16/9] overflow-hidden rounded-xl">
            <img
              src={post.image_url}
              alt={post.image_alt_text || post.blog_title}
              className="h-full w-full object-cover"
              width={1536}
              height={864}
            />
          </div>
        ) : (
          <div className="mb-8 flex aspect-[16/9] items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
            Kein Hero-Bild
          </div>
        )}

        <div
          className="blog-prose break-words [&_img]:max-w-full [&_table]:block [&_table]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: post.blog_body || "<p>Noch kein Artikel-Inhalt vorhanden.</p>" }}
        />
        {/* key erzwingt Re-Hydration der Widgets nach Body-Aenderungen */}
        <BlogWidgets key={`${post.updated_at || ""}-${post.blog_body?.length || 0}`} />
      </article>
    </div>
  );
}
