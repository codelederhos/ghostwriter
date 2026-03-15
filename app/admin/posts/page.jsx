"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/posts")
      .then(r => r.json())
      .then(data => { setPosts(data.posts || []); setLoading(false); });
  }, []);

  return (
    <div>
      <h1 className="admin-title">Posts</h1>

      <div className="admin-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-3 font-medium text-muted-foreground">Titel</th>
              <th className="pb-3 font-medium text-muted-foreground">Tenant</th>
              <th className="pb-3 font-medium text-muted-foreground">Sprache</th>
              <th className="pb-3 font-medium text-muted-foreground">Kategorie</th>
              <th className="pb-3 font-medium text-muted-foreground">Status</th>
              <th className="pb-3 font-medium text-muted-foreground">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3, 4, 5].map(i => (
                <tr key={i} className="border-b border-border/50 animate-pulse">
                  {[1, 2, 3, 4, 5, 6].map(j => (
                    <td key={j} className="py-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : posts.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                  Noch keine Posts. Sobald die Pipeline läuft, erscheinen hier die generierten Artikel.
                </td>
              </tr>
            ) : posts.map(p => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="py-3 font-medium max-w-[300px] truncate">
                  {p.blog_slug ? (
                    <Link href={`/${p.tenant_slug}/de/blog/${p.blog_slug}`} target="_blank" className="hover:text-primary">
                      {p.blog_title || "Ohne Titel"}
                    </Link>
                  ) : (
                    p.blog_title || "Ohne Titel"
                  )}
                </td>
                <td className="py-3 text-muted-foreground">{p.tenant_name}</td>
                <td className="py-3 text-muted-foreground">{p.language?.toUpperCase()}</td>
                <td className="py-3 text-muted-foreground">{p.category}</td>
                <td className="py-3">
                  <span className={
                    p.status === "published" ? "badge-success" :
                    p.status === "failed" ? "badge-error" :
                    "badge-neutral"
                  }>
                    {p.status === "published" ? "Live" : p.status === "failed" ? "Fehler" : p.status}
                  </span>
                </td>
                <td className="py-3 text-muted-foreground">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString("de") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
