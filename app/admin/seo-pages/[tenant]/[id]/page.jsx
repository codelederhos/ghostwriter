"use client";
import { useState, useEffect, use } from "react";
import Link from "next/link";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

export default function SeoPageDetailPage(props) {
  const params = use(props.params);
  const { tenant, id } = params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState("performance"); // performance | content | diagnose

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const res = await fetch(`/api/admin/seo/${tenant}/pages/${id}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }

  async function regenerate() {
    setRegenerating(true);
    setPreview(null);
    setMsg(null);
    const res = await fetch(`/api/admin/seo/${tenant}/pages/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate" }),
    });
    const d = await res.json();
    setRegenerating(false);
    if (d.ok) { setPreview(d.preview); setMsg({ type: "success", text: "Content neu generiert — Status: review" }); loadData(); }
    else setMsg({ type: "error", text: d.error || "Fehler" });
  }

  async function publish() {
    await fetch(`/api/admin/seo/${tenant}/pages/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    setMsg({ type: "success", text: "Seite published." });
    loadData();
  }

  if (loading) return <div className="p-8 text-gray-400">Laden...</div>;
  const { page, diagnostics: diag, metrics, topQueries } = data;

  const flagLabels = [
    { key: "flag_not_indexed",   label: "Nicht indexiert", color: "red" },
    { key: "flag_ctr_low",       label: "CTR niedrig",     color: "orange" },
    { key: "flag_bounce_high",   label: "Bounce hoch",     color: "orange" },
    { key: "flag_no_cta",        label: "Kein CTA-Klick",  color: "yellow" },
    { key: "flag_position_drop", label: "Position gesunken","color": "red" },
    { key: "flag_near_page1",    label: "Near Page 1",     color: "blue" },
    { key: "flag_keyword_gap",   label: "Keyword-Gap",     color: "yellow" },
  ].filter(f => diag?.[f.key]);

  const m7 = metrics.slice(0, 7);
  const imp7  = m7.reduce((s, m) => s + (m.gsc_impressions || 0), 0);
  const clk7  = m7.reduce((s, m) => s + (m.gsc_clicks || 0), 0);
  const ses7  = m7.reduce((s, m) => s + (m.ana_sessions || 0), 0);
  const cta7  = m7.reduce((s, m) => s + (m.ana_cta_clicks || 0), 0);
  const pos7  = m7.filter(m => m.gsc_position > 0);
  const avgPos = pos7.length > 0 ? (pos7.reduce((s, m) => s + parseFloat(m.gsc_position), 0) / pos7.length).toFixed(1) : null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/seo-pages" className="text-gray-400 hover:text-white">SEO Hub</Link>
        <span className="text-gray-600">/</span>
        <Link href={`/admin/seo-pages/${tenant}`} className="text-gray-400 hover:text-white capitalize">{tenant}</Link>
        <span className="text-gray-600">/</span>
        <span className="text-white">{page.slug}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{page.slug}</h1>
          <p className="text-gray-400 text-sm mt-1">{page.location_name} · {page.lang.toUpperCase()} · {page.slug_template}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm px-3 py-1 rounded-full ${
            page.status === "published" ? "bg-green-900 text-green-300" :
            page.status === "review"    ? "bg-yellow-900 text-yellow-300" :
            "bg-gray-700 text-gray-400"
          }`}>{page.status}</span>
          {page.status === "review" && (
            <button onClick={publish} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition">
              Publish
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          msg.type === "success" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
        }`}>{msg.text}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-700">
        {["performance", "diagnose", "content"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
              tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-white"
            }`}>{t}</button>
        ))}
      </div>

      {/* Performance Tab */}
      {tab === "performance" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Impressionen (7d)", value: imp7, color: "text-white" },
              { label: "Klicks (7d)", value: clk7, color: "text-green-400" },
              { label: "Ø Position", value: avgPos || "—", color: "text-blue-400" },
              { label: "CTA-Klicks (7d)", value: cta7, color: "text-purple-400" },
            ].map(s => (
              <div key={s.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-gray-400 text-sm mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Top Queries */}
          {topQueries.length > 0 && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h3 className="font-medium text-white text-sm">Top Suchanfragen (GSC, letzte 7 Tage)</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left px-4 py-2">Query</th>
                    <th className="px-4 py-2">Impressionen</th>
                    <th className="px-4 py-2">Klicks</th>
                    <th className="px-4 py-2">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {topQueries.map((q, i) => (
                    <tr key={i} className="border-b border-gray-700/50">
                      <td className="px-4 py-2 text-gray-200">{q.query}</td>
                      <td className="px-4 py-2 text-center text-gray-300">{q.impressions}</td>
                      <td className="px-4 py-2 text-center text-gray-300">{q.clicks}</td>
                      <td className="px-4 py-2 text-center text-gray-300">{q.position}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Diagnose Tab */}
      {tab === "diagnose" && (
        <div className="space-y-4">
          {flagLabels.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400 bg-green-900/20 rounded-xl p-4 border border-green-800">
              <CheckCircle className="w-5 h-5" /> Keine Probleme erkannt.
            </div>
          ) : (
            flagLabels.map(f => (
              <div key={f.key} className={`flex items-center gap-3 rounded-xl p-4 border ${
                f.color === "red"    ? "bg-red-900/20 border-red-800 text-red-300" :
                f.color === "orange" ? "bg-orange-900/20 border-orange-800 text-orange-300" :
                f.color === "blue"   ? "bg-blue-900/20 border-blue-800 text-blue-300" :
                "bg-yellow-900/20 border-yellow-800 text-yellow-300"
              }`}>
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{f.label}</span>
              </div>
            ))
          )}

          {diag?.keyword_gaps?.length > 0 && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <h3 className="font-medium text-white text-sm mb-3">Keyword-Gaps</h3>
              <div className="space-y-2">
                {diag.keyword_gaps.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-yellow-300">"{g.query}"</span>
                    <span className="text-gray-400">{g.impressions} Impressionen · fehlt im Content</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={regenerate} disabled={regenerating}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition font-medium">
            <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Generiert..." : "Content neu generieren (KI)"}
          </button>
        </div>
      )}

      {/* Content Tab */}
      {tab === "content" && (
        <div className="space-y-4">
          {[
            { label: "Title", value: preview?.title || page.title },
            { label: "H1", value: preview?.h1 || page.h1 },
            { label: "Meta Description", value: preview?.meta_description || page.meta_description },
          ].map(f => (
            <div key={f.label} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <div className="text-gray-400 text-xs mb-2">{f.label}</div>
              <div className="text-gray-200 text-sm">{f.value || "—"}</div>
            </div>
          ))}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <div className="text-gray-400 text-xs mb-2">Intro</div>
            <div className="text-gray-200 text-sm prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: preview?.intro_html || page.intro_html || "—" }} />
          </div>
        </div>
      )}
    </div>
  );
}
