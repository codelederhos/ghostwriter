"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  fmtDatumDE,
  statusBadgeClass,
  statusLabel,
  qaScoreBadgeClass,
  gateLabel,
} from "./draftUtils";

export default function DraftsPage() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/drafts?includeRejected=${showRejected ? "1" : "0"}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok === false) throw new Error(data.error || "Fehler beim Laden");
        setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [showRejected]);

  const tenants = useMemo(() => {
    const map = new Map();
    drafts.forEach((d) => { if (d.tenant_id) map.set(d.tenant_id, d.tenant_name || d.tenant_slug); });
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "de"));
  }, [drafts]);

  const filtered = useMemo(() => {
    return drafts.filter((d) => {
      const matchSearch = !search || [d.blog_title, d.tenant_name, d.category, d.blog_slug].some(
        (v) => v?.toLowerCase().includes(search.toLowerCase())
      );
      const matchTenant = tenantFilter === "all" || d.tenant_id === tenantFilter;
      return matchSearch && matchTenant;
    });
  }, [drafts, search, tenantFilter]);

  return (
    <div>
      <h1 className="admin-title">Drafts</h1>
      <p className="-mt-4 mb-6 text-sm text-muted-foreground">
        Redaktions-Workspace für Review-Entwürfe. Keine Veröffentlichung ohne separaten Freigabe-Schritt.
      </p>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="form-input pl-8"
            placeholder="Suche nach Titel, Tenant, Kategorie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select w-auto"
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
        >
          <option value="all">Alle Tenants</option>
          {tenants.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground self-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRejected}
            onChange={(e) => setShowRejected(e.target.checked)}
            className="rounded border-border"
          />
          Verworfene anzeigen
        </label>
        {!loading && (
          <span className="text-sm text-muted-foreground self-center">
            {filtered.length} von {drafts.length}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Fehler: {error}
        </div>
      )}

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
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="border-b border-border/50 animate-pulse">
                    {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {drafts.length === 0
                      ? "Keine Review-Drafts. Sobald ein Tenant mit publish_mode 'review' Artikel erzeugt, erscheinen sie hier."
                      : "Keine Drafts für diesen Filter."}
                  </td>
                </tr>
              ) : filtered.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/drafts/${d.id}`} className="hover:text-primary">
                      <span className="line-clamp-1 break-words">{d.blog_title || "Ohne Titel"}</span>
                    </Link>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-1 break-all">/{d.blog_slug}</span>
                    {d.is_test && <span className="badge badge-info mt-1">Test</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="badge badge-neutral">{d.tenant_name}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="badge badge-neutral">{d.language?.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{d.category}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-col gap-1">
                      <span className={qaScoreBadgeClass(d.qa_score)}>{d.qa_score ?? "—"}/10</span>
                      {gateLabel(d.qa?.status) && (
                        <span className="text-[11px] text-muted-foreground">Gate: {gateLabel(d.qa.status)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusBadgeClass(d.status)}>{statusLabel(d.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell text-right whitespace-nowrap">
                    {fmtDatumDE(d.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
