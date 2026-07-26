"use client";
import { useState, useEffect, use } from "react";
import Link from "next/link";
import { AlertTriangle, XCircle, TrendingUp, CheckCircle, RefreshCw } from "lucide-react";

const FLAG_LABELS = {
  flag_not_indexed:   { label: "Nicht indexiert", color: "text-red-400" },
  flag_ctr_low:       { label: "CTR niedrig",     color: "text-orange-400" },
  flag_bounce_high:   { label: "Bounce hoch",     color: "text-orange-400" },
  flag_no_cta:        { label: "Kein CTA",        color: "text-yellow-400" },
  flag_position_drop: { label: "Pos. gesunken",   color: "text-red-400" },
  flag_near_page1:    { label: "Near Page 1",     color: "text-blue-400" },
  flag_keyword_gap:   { label: "Keyword-Gap",     color: "text-yellow-400" },
};

export default function SeoTenantPage(props) {
  const params = use(props.params);
  const { tenant } = params;
  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [lang, setLang] = useState("");

  useEffect(() => { loadPages(); }, [filter, lang]);

  async function loadPages() {
    setLoading(true);
    const qs = new URLSearchParams({ filter, limit: "100" });
    if (lang) qs.set("lang", lang);
    const res = await fetch(`/api/admin/seo/${tenant}/pages?${qs}`);
    const data = await res.json();
    setPages(data.pages || []);
    setTotal(data.total || 0);
    setLoading(false);
  }

  const FILTERS = [
    { key: "all",         label: "Alle" },
    { key: "critical",    label: "❌ Kritisch" },
    { key: "warn",        label: "⚠ Warnung" },
    { key: "not_indexed", label: "Nicht indexiert" },
    { key: "near_page1",  label: "Near Page 1" },
    { key: "ok",          label: "✅ OK" },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/seo-pages" className="text-gray-400 hover:text-white text-sm">← SEO Hub</Link>
        <span className="text-gray-600">/</span>
        <h1 className="text-xl font-bold text-white capitalize">{tenant}</h1>
        <span className="text-gray-500 text-sm">({total} Seiten)</span>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              filter === f.key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}>
            {f.label}
          </button>
        ))}
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="ml-auto px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-300 border border-gray-700">
          <option value="">Alle Sprachen</option>
          <option value="de">DE</option>
          <option value="ro">RO</option>
          <option value="en">EN</option>
        </select>
      </div>

      {/* Tabelle */}
      {loading ? (
        <div className="text-gray-400 py-8">Laden...</div>
      ) : (
        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="text-left px-4 py-3">Seite</th>
                <th className="px-4 py-3">Lang</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pos.</th>
                <th className="px-4 py-3">Klicks</th>
                <th className="px-4 py-3">CTA</th>
                <th className="text-left px-4 py-3">Diagnose</th>
              </tr>
            </thead>
            <tbody>
              {pages.map(p => {
                const activeFlags = Object.entries(FLAG_LABELS)
                  .filter(([k]) => p[k])
                  .map(([k, v]) => v);
                return (
                  <tr key={p.id} className="border-b border-gray-700/50 hover:bg-gray-750 transition">
                    <td className="px-4 py-3">
                      <Link href={`/admin/seo-pages/${tenant}/${p.id}`}
                        className="text-blue-400 hover:text-blue-300 font-medium">
                        {p.slug}
                      </Link>
                      <div className="text-gray-500 text-xs mt-0.5">{p.location_name} · {p.slug_template}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-gray-700 px-2 py-0.5 rounded text-xs text-gray-300">{p.lang.toUpperCase()}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        p.status === "published" ? "bg-green-900 text-green-300" :
                        p.status === "review"    ? "bg-yellow-900 text-yellow-300" :
                        "bg-gray-700 text-gray-400"
                      }`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">
                      {p.pos_7d ? parseFloat(p.pos_7d).toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">{p.clicks_7d || 0}</td>
                    <td className="px-4 py-3 text-center text-gray-300">{p.cta_7d || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {activeFlags.map((f, i) => (
                          <span key={i} className={`text-xs ${f.color}`}>{f.label}</span>
                        ))}
                        {activeFlags.length === 0 && p.status === "published" && (
                          <span className="text-xs text-green-400">✓</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pages.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Keine Seiten gefunden.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
