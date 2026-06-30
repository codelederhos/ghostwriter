"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    fetch("/api/admin/posts")
      .then(r => r.json())
      .then(data => { setPosts(data.posts || []); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    return posts.filter(p => {
      const matchSearch = !search || [p.blog_title, p.tenant_name, p.category].some(
        v => v?.toLowerCase().includes(search.toLowerCase())
      );
      const matchStatus = filterStatus === "all" || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [posts, search, filterStatus]);

  const statusClass = (s) =>
    s === "published" ? "badge badge-success" :
    s === "failed"    ? "badge badge-error" :
    s === "draft_review" ? "badge badge-warning" :
    s === "draft"     ? "badge badge-warning" : "badge badge-neutral";

  const statusLabel = (s) =>
    s === "published" ? "Live" :
    s === "failed" ? "Fehler" :
    s === "draft_review" ? "Review" :
    s;

  const parseQa = (value) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return null; }
  };

  const qaState = (post) => {
    const qa = parseQa(post.qa_issues);
    const checks = Array.isArray(qa?.checks) ? qa.checks : [];
    const failed = checks.filter(check => !check.passed);
    const hasGate = Boolean(qa?.version);
    return {
      qa,
      hasGate,
      checks,
      failed,
      status: qa?.status || (failed.length ? "review" : "ready_for_approval"),
      label: qa?.status === "ready_for_approval" ? "bereit" : qa?.status === "needs_revision" ? "nacharbeiten" : "prüfen",
    };
  };

  return (
    <div>
      <h1 className="admin-title">Posts</h1>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="form-input pl-8"
            placeholder="Suche nach Titel, Tenant, Kategorie..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select w-auto"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">Alle Status</option>
          <option value="published">Live</option>
          <option value="draft">Draft</option>
          <option value="draft_review">Review</option>
          <option value="failed">Fehler</option>
        </select>
        {!loading && (
          <span className="text-sm text-muted-foreground self-center">
            {filtered.length} von {posts.length}
          </span>
        )}
      </div>

      <div className="admin-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="px-4 py-3 font-medium text-muted-foreground">Titel</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Tenant</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Sprache</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Kategorie</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">QA</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell text-right">Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i} className="border-b border-border/50 animate-pulse">
                    {[1,2,3,4,5,6,7].map(j => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {posts.length === 0
                      ? "Noch keine Posts. Sobald die Pipeline läuft, erscheinen hier die Artikel."
                      : "Keine Posts für diesen Filter."}
                  </td>
                </tr>
              ) : filtered.map(p => {
                const qa = qaState(p);
                return (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <span className="line-clamp-1">
                      {p.blog_slug && p.status === "published" ? (
                        <Link href={`/${p.tenant_slug}/de/blog/${p.blog_slug}`} target="_blank" className="hover:text-primary">
                          {p.blog_title || "Ohne Titel"}
                        </Link>
                      ) : (
                        p.blog_title || "Ohne Titel"
                      )}
                    </span>
                    {qa.checks.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        {qa.checks.slice(0, 4).map((check) => (
                          <span
                            key={check.id}
                            className={`rounded-full border px-2 py-0.5 ${check.passed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                            title={check.message}
                          >
                            {check.passed ? "✓" : "!"} {check.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{p.tenant_name}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="badge badge-neutral">{p.language?.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{p.category}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-col gap-1">
                      <span className={`badge ${p.qa_score >= 8 ? "badge-success" : p.qa_score >= 6 ? "badge-warning" : "badge-error"}`}>
                        {p.qa_score ?? "—"}/10
                      </span>
                      {qa.hasGate && (
                        <span className="text-[11px] text-muted-foreground">
                          Gate: {qa.label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusClass(p.status)}>{statusLabel(p.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell text-right whitespace-nowrap">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString("de") : "—"}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
