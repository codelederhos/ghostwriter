"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Search, Filter, Globe, MapPin, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, XCircle, Clock, Eye, EyeOff, ChevronDown, ChevronRight,
  Plus, Trash2, X, Check, Wand2, FileText, BarChart3, ExternalLink,
  Loader2, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

const STATUS_STYLES = {
  draft:     { label: "Entwurf",       cls: "bg-gray-100 text-gray-600 border-gray-200",     dot: "bg-gray-400" },
  review:    { label: "Review",        cls: "bg-amber-50 text-amber-700 border-amber-200",    dot: "bg-amber-400" },
  published: { label: "Veröffentlicht", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  noindex:   { label: "Noindex",       cls: "bg-red-50 text-red-600 border-red-200",          dot: "bg-red-400" },
};

const SEVERITY_STYLES = {
  ok:       { label: "OK",        cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  warn:     { label: "Warnung",   cls: "bg-amber-50 text-amber-700",    icon: AlertTriangle },
  critical: { label: "Kritisch",  cls: "bg-red-50 text-red-700",        icon: XCircle },
};

export default function SeoHub({ tenantId, showMsg }) {
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState([]);
  const [types, setTypes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [stats, setStats] = useState({});

  // Filters
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterLang, setFilterLang] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [filterSeverity, setFilterSeverity] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Selection
  const [selectedPages, setSelectedPages] = useState(new Set());

  // Detail
  const [detailPage, setDetailPage] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailClosing, setDetailClosing] = useState(false);

  // Load data
  useEffect(() => { loadSeoData(); }, [tenantId]);

  async function loadSeoData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/seo?view=overview`);
      const data = await res.json();
      setPages(data.pages || []);
      setTypes(data.types || []);
      setLocations(data.locations || []);
      setStats(data.stats || {});
    } catch (e) {
      showMsg?.("SEO Hub laden fehlgeschlagen", "error");
    }
    setLoading(false);
  }

  async function loadDetail(pageId) {
    setDetailPage(pageId);
    setDetailLoading(true);
    setDetailClosing(false);
    const res = await fetch(`/api/tenants/${tenantId}/seo?view=page&pageId=${pageId}`);
    const data = await res.json();
    setDetailData(data);
    setDetailLoading(false);
  }

  function closeDetail() {
    setDetailClosing(true);
    setTimeout(() => { setDetailPage(null); setDetailData(null); setDetailClosing(false); }, 250);
  }

  async function bulkSetStatus(status) {
    const ids = Array.from(selectedPages);
    if (!ids.length) return;
    await fetch(`/api/tenants/${tenantId}/seo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bulk_status", pageIds: ids, status }),
    });
    setPages(prev => prev.map(p => selectedPages.has(p.id) ? { ...p, status, ...(status === "published" ? { published_at: new Date().toISOString() } : {}) } : p));
    setSelectedPages(new Set());
    showMsg?.(`${ids.length} Seiten → ${STATUS_STYLES[status]?.label}`);
  }

  async function updatePageField(pageId, field, value) {
    await fetch(`/api/tenants/${tenantId}/seo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_page", pageId, [field]: value }),
    });
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, [field]: value } : p));
    if (detailData?.page?.id === pageId) {
      setDetailData(prev => ({ ...prev, page: { ...prev.page, [field]: value } }));
    }
  }

  // Filtered pages
  const filtered = pages.filter(p => {
    if (filterStatus && p.status !== filterStatus) return false;
    if (filterLang && p.lang !== filterLang) return false;
    if (filterType && p.page_type_id !== filterType) return false;
    if (filterSeverity === "critical" && p.severity !== "critical") return false;
    if (filterSeverity === "warn" && p.severity !== "warn") return false;
    if (filterSeverity === "ok" && (p.severity === "critical" || p.severity === "warn")) return false;
    if (filterSeverity === "not_indexed" && !p.flag_not_indexed) return false;
    if (filterSeverity === "near_page1" && !p.flag_near_page1) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!p.slug.includes(q) && !(p.location_name?.de || "").toLowerCase().includes(q) && !p.slug_template?.includes(q)) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="admin-card animate-pulse"><div className="h-24 bg-muted rounded" /></div>
        <div className="admin-card animate-pulse"><div className="h-64 bg-muted rounded" /></div>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="admin-card text-center py-12">
        <Globe size={36} className="mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold mb-1">SEO Hub</h3>
        <p className="text-sm text-muted-foreground mb-4">Noch keine SEO-Seiten für diesen Tenant.</p>
        <p className="text-xs text-muted-foreground">Erstelle Page Types und Locations um programmatische SEO-Seiten zu generieren.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stats Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Gesamt", value: stats.total, color: "text-foreground" },
          { label: "Veröffentlicht", value: stats.published, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Entwurf", value: stats.draft, color: "text-gray-500", bg: "bg-gray-50" },
          { label: "Review", value: stats.review, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Kritisch", value: stats.critical, color: "text-red-600", bg: "bg-red-50" },
          { label: "Near Page 1", value: stats.nearPage1, color: "text-indigo-600", bg: "bg-indigo-50" },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border border-border p-3 ${s.bg || "bg-card"} transition-all hover:shadow-sm`}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value || 0}</p>
          </div>
        ))}
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────── */}
      <div className="admin-card !p-3 space-y-2">
        {/* Status Filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: null, label: `Alle ${stats.total}` },
            { key: "published", label: `✅ Veröffentlicht ${stats.published}` },
            { key: "draft", label: `📝 Entwurf ${stats.draft}` },
            { key: "review", label: `⏳ Review ${stats.review}` },
            { key: "noindex", label: `🚫 Noindex ${stats.noindex}` },
          ].map(f => {
            if (f.key && !stats[f.key]) return null;
            const active = filterStatus === f.key;
            return (
              <button key={String(f.key)} onClick={() => setFilterStatus(active ? null : f.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all font-medium ${
                  active ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-muted-foreground/40"
                }`}>{f.label}</button>
            );
          })}

          <div className="w-px h-4 bg-border mx-1" />

          {/* Diagnose Filter */}
          {[
            { key: "critical", label: "❌ Kritisch", count: stats.critical },
            { key: "warn", label: "⚠️ Warnung", count: stats.warn },
            { key: "not_indexed", label: "🔍 Nicht indexiert", count: stats.notIndexed },
            { key: "near_page1", label: "🎯 Near Page 1", count: stats.nearPage1 },
          ].map(f => {
            if (!f.count) return null;
            const active = filterSeverity === f.key;
            return (
              <button key={f.key} onClick={() => setFilterSeverity(active ? null : f.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all font-medium ${
                  active
                    ? f.key === "critical" ? "bg-red-100 text-red-800 border-red-300"
                    : f.key === "near_page1" ? "bg-indigo-100 text-indigo-800 border-indigo-300"
                    : "bg-amber-100 text-amber-800 border-amber-300"
                    : "border-border text-muted-foreground hover:border-muted-foreground/40"
                }`}>{f.label} {f.count}</button>
            );
          })}
        </div>

        {/* Second row: Lang + Type + Search */}
        <div className="flex items-center gap-2">
          {/* Lang */}
          {stats.languages?.length > 1 && (
            <div className="flex items-center gap-0.5">
              {[null, ...stats.languages].map(lang => (
                <button key={String(lang)} onClick={() => setFilterLang(filterLang === lang ? null : lang)}
                  className={`text-[11px] px-2 py-1 rounded-lg border transition-all ${
                    filterLang === lang ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted"
                  }`}>
                  {lang ? lang.toUpperCase() : "Alle"}
                </button>
              ))}
            </div>
          )}

          {/* Type */}
          {types.length > 1 && (
            <select
              className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              value={filterType || ""}
              onChange={(e) => setFilterType(e.target.value || null)}
            >
              <option value="">Alle Typen</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.slug_template} ({t.category})</option>)}
            </select>
          )}

          {/* Search */}
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input
              className="w-full text-xs rounded-lg border border-border pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 transition-all"
              placeholder="Slug oder Ort suchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{filtered.length} Seiten</span>
        </div>
      </div>

      {/* ── Page Table ───────────────────────────────────────────── */}
      <div className="admin-card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 px-3 py-3">
                <input type="checkbox"
                  checked={selectedPages.size === filtered.length && filtered.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedPages(new Set(filtered.map(p => p.id)));
                    else setSelectedPages(new Set());
                  }}
                  className="rounded border-border"
                />
              </th>
              <th className="text-left px-3 py-3 font-medium text-muted-foreground">Seite</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground w-14">Lang</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground w-24">Status</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground w-16 hidden lg:table-cell">Wörter</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground w-20 hidden lg:table-cell">Diagnose</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((page, i) => {
              const isSelected = selectedPages.has(page.id);
              const statusStyle = STATUS_STYLES[page.status] || STATUS_STYLES.draft;
              const locName = page.location_name?.de || page.location_name?.en || "";
              const sevStyle = page.severity ? SEVERITY_STYLES[page.severity] : null;
              const SevIcon = sevStyle?.icon;

              return (
                <tr key={page.id}
                  className={`border-b border-border/30 transition-colors cursor-pointer ${
                    isSelected ? "bg-indigo-50/40" : "hover:bg-muted/20"
                  }`}
                  style={{ animation: `cardFadeUp 300ms cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 20) * 20}ms both` }}
                  onClick={() => loadDetail(page.id)}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected}
                      onChange={() => {
                        const s = new Set(selectedPages);
                        isSelected ? s.delete(page.id) : s.add(page.id);
                        setSelectedPages(s);
                      }}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-sm font-medium text-indigo-700 hover:text-indigo-900 transition-colors">{page.slug}</p>
                    <p className="text-[11px] text-muted-foreground">{locName} · {page.slug_template}</p>
                  </td>
                  <td className="text-center px-3 py-2.5">
                    <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{page.lang.toUpperCase()}</span>
                  </td>
                  <td className="text-center px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusStyle.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {statusStyle.label}
                    </span>
                  </td>
                  <td className="text-center px-3 py-2.5 hidden lg:table-cell">
                    <span className={`text-xs tabular-nums ${page.word_count >= 700 ? "text-emerald-600" : page.word_count > 0 ? "text-amber-600" : "text-muted-foreground/40"}`}>
                      {page.word_count || "—"}
                    </span>
                  </td>
                  <td className="text-center px-3 py-2.5 hidden lg:table-cell">
                    {sevStyle && SevIcon ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${sevStyle.cls}`}>
                        <SevIcon size={10} />
                        {sevStyle.label}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length > 100 && (
          <div className="px-4 py-3 text-xs text-muted-foreground text-center border-t border-border">
            Zeige 100 von {filtered.length} Seiten. Filter nutzen um einzugrenzen.
          </div>
        )}
      </div>

      {/* ── Bulk Actions Bar ─────────────────────────────────────── */}
      {selectedPages.size > 0 && createPortal(
        <div
          style={{ position: "fixed", bottom: 24, left: "50%", zIndex: 500, animation: "floatBarIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both" }}
          className="flex items-center gap-1.5 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-white/15">
            <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">{selectedPages.size}</span>
            </div>
            <span className="text-[11px] text-white/70 whitespace-nowrap">Seiten</span>
          </div>

          <button onClick={() => bulkSetStatus("published")}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-500 transition-all whitespace-nowrap">
            ✅ Veröffentlichen
          </button>
          <button onClick={() => bulkSetStatus("review")}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white/10 text-white/80 hover:bg-amber-500 hover:text-white border border-white/15 transition-all whitespace-nowrap">
            ⏳ Review
          </button>
          <button onClick={() => bulkSetStatus("noindex")}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white/10 text-white/80 hover:bg-red-500 hover:text-white border border-white/15 transition-all whitespace-nowrap">
            🚫 Noindex
          </button>

          <div className="w-px h-5 bg-white/15 mx-0.5" />

          <button onClick={() => { setSelectedPages(new Set()); }}
            className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all">
            <X size={12} />
          </button>
        </div>,
        document.body
      )}

      {/* ── Detail Slide-Over ────────────────────────────────────── */}
      {detailPage && createPortal(
        <div
          className="fixed inset-0 z-[200] flex justify-end"
          style={{
            backgroundColor: detailClosing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.35)",
            backdropFilter: detailClosing ? "none" : "blur(4px)",
            transition: "background-color 250ms, backdrop-filter 250ms",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}
        >
          <div
            className="relative bg-card h-full shadow-2xl overflow-hidden flex flex-col border-l border-border"
            style={{
              width: "min(560px, 95vw)",
              animation: detailClosing
                ? "slideOutRight 250ms cubic-bezier(0.16,1,0.3,1) both"
                : "slideInRight 300ms cubic-bezier(0.16,1,0.3,1) both",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{detailData?.page?.slug || "Lädt…"}</p>
                {detailData?.page && (
                  <p className="text-xs text-muted-foreground">
                    {detailData.page.location_name?.de} · {detailData.page.lang.toUpperCase()} · {detailData.page.category}
                  </p>
                )}
              </div>
              <button onClick={closeDetail} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : detailData?.page ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Status */}
                <div className="flex items-center gap-2">
                  {Object.entries(STATUS_STYLES).map(([key, style]) => (
                    <button key={key}
                      onClick={() => updatePageField(detailData.page.id, "status", key)}
                      className={`text-[11px] px-3 py-1.5 rounded-lg border-2 font-medium transition-all ${
                        detailData.page.status === key
                          ? style.cls + " border-2"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40"
                      }`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${detailData.page.status === key ? style.dot : "bg-muted-foreground/30"}`} />
                      {style.label}
                    </button>
                  ))}
                </div>

                {/* Meta */}
                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Title Tag</p>
                  <input
                    className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 transition-all"
                    value={detailData.page.title || ""}
                    onChange={(e) => setDetailData(prev => ({ ...prev, page: { ...prev.page, title: e.target.value } }))}
                    onBlur={(e) => updatePageField(detailData.page.id, "title", e.target.value)}
                  />
                  <p className={`text-[10px] mt-1 ${(detailData.page.title?.length || 0) > 60 ? "text-red-500" : "text-muted-foreground/50"}`}>
                    {detailData.page.title?.length || 0}/60
                  </p>
                </section>

                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">H1</p>
                  <input
                    className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 transition-all"
                    value={detailData.page.h1 || ""}
                    onChange={(e) => setDetailData(prev => ({ ...prev, page: { ...prev.page, h1: e.target.value } }))}
                    onBlur={(e) => updatePageField(detailData.page.id, "h1", e.target.value)}
                  />
                </section>

                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Meta Description</p>
                  <textarea
                    className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400/40 transition-all"
                    rows={3}
                    value={detailData.page.meta_description || ""}
                    onChange={(e) => setDetailData(prev => ({ ...prev, page: { ...prev.page, meta_description: e.target.value } }))}
                    onBlur={(e) => updatePageField(detailData.page.id, "meta_description", e.target.value)}
                  />
                  <p className={`text-[10px] mt-1 ${(detailData.page.meta_description?.length || 0) > 160 ? "text-red-500" : "text-muted-foreground/50"}`}>
                    {detailData.page.meta_description?.length || 0}/160
                  </p>
                </section>

                {/* Content Blöcke */}
                {["intro_html", "local_html", "practical_html"].map(field => {
                  const labels = { intro_html: "Intro (200W)", local_html: "Lokal (200W)", practical_html: "Praktisches (150W)" };
                  return (
                    <section key={field}>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{labels[field]}</p>
                      {detailData.page[field] ? (
                        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3 border border-border/50 prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: detailData.page[field] }} />
                      ) : (
                        <div className="text-xs text-muted-foreground/40 italic bg-muted/10 rounded-lg p-3 border border-dashed border-border">
                          Noch nicht generiert
                        </div>
                      )}
                    </section>
                  );
                })}

                {/* FAQ */}
                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">FAQ</p>
                  {detailData.page.faq_json?.length > 0 ? (
                    <div className="space-y-2">
                      {detailData.page.faq_json.map((faq, i) => (
                        <details key={i} className="rounded-lg border border-border overflow-hidden">
                          <summary className="px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted/30 transition-colors">{faq.q}</summary>
                          <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50 bg-muted/10">{faq.a}</div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/40 italic">Keine FAQs</p>
                  )}
                </section>

                {/* Diagnose */}
                {detailData.diagnostics && (
                  <section>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Diagnose</p>
                    <div className="space-y-1.5">
                      {[
                        { flag: "flag_not_indexed", label: "Nicht indexiert", desc: "0 Impressions in 30 Tagen", color: "red" },
                        { flag: "flag_ctr_low", label: "CTR zu niedrig", desc: "CTR < 1.5% bei Position ≤ 20", color: "amber" },
                        { flag: "flag_near_page1", label: "Near Page 1", desc: "Position 11–20, Optimierungspotenzial", color: "indigo" },
                        { flag: "flag_bounce_high", label: "Hohe Absprungrate", desc: "Bounce > 75%", color: "amber" },
                        { flag: "flag_no_cta", label: "Keine CTA-Klicks", desc: "CTA-Rate < 2%", color: "amber" },
                        { flag: "flag_position_drop", label: "Position gefallen", desc: "Position um > 5 verschlechtert", color: "red" },
                        { flag: "flag_keyword_gap", label: "Keyword-Lücke", desc: "GSC-Queries nicht im Content", color: "amber" },
                      ].filter(f => detailData.diagnostics[f.flag]).map(f => (
                        <div key={f.flag} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-${f.color}-200 bg-${f.color}-50 text-${f.color}-700`}>
                          <AlertTriangle size={12} />
                          <div>
                            <span className="font-medium">{f.label}</span>
                            <span className="text-muted-foreground ml-1.5">{f.desc}</span>
                          </div>
                        </div>
                      ))}
                      {!Object.values(detailData.diagnostics).some(v => v === true) && (
                        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                          <CheckCircle2 size={12} /> Keine Probleme erkannt
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Metrics */}
                {detailData.metrics?.length > 0 && (
                  <section>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Letzte 7 Tage</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(() => {
                        const last7 = detailData.metrics.slice(0, 7);
                        const impressions = last7.reduce((s, m) => s + (m.gsc_impressions || 0), 0);
                        const clicks = last7.reduce((s, m) => s + (m.gsc_clicks || 0), 0);
                        const avgPos = last7.length > 0 ? (last7.reduce((s, m) => s + (m.gsc_position || 0), 0) / last7.length).toFixed(1) : "—";
                        const sessions = last7.reduce((s, m) => s + (m.ana_sessions || 0), 0);
                        return [
                          { label: "Impressions", value: impressions },
                          { label: "Klicks", value: clicks },
                          { label: "Ø Position", value: avgPos },
                          { label: "Sessions", value: sessions },
                        ].map(m => (
                          <div key={m.label} className="rounded-lg border border-border p-2 text-center">
                            <p className="text-[9px] text-muted-foreground uppercase">{m.label}</p>
                            <p className="text-lg font-bold tabular-nums">{m.value}</p>
                          </div>
                        ));
                      })()}
                    </div>
                  </section>
                )}
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
