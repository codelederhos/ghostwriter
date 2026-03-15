"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Users, FileText, AlertCircle, TrendingUp,
  BarChart3, LineChart, X, ArrowRight, Activity,
} from "lucide-react";

/* ── Helpers ─────────────────────────────────────────── */

function CountUp({ value, duration = 900, delay = 300 }) {
  const ref = useRef(null);
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current, to = value;
    prev.current = to;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const elapsed = ts - start - delay;
      if (elapsed < 0) { requestAnimationFrame(step); return; }
      const p = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * ease).toLocaleString("de-DE");
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value, duration, delay]);
  return <span ref={ref}>{value.toLocaleString("de-DE")}</span>;
}

const fmtNum = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("de-DE");
};

const PLACEHOLDER_POINTS = "0,28 17,24 34,26 51,20 68,22 85,16 102,18 120,10";

const toPoints = (values, w = 120, h = 32) => {
  if (!values || !values.length || values.every(v => v === 0)) return null;
  const max = Math.max(...values, 1);
  return values.map((v, i) =>
    `${(i / Math.max(values.length - 1, 1)) * w},${h - (v / max) * (h - 4)}`
  ).join(" ");
};

const calcDelta = (current, previous) => {
  if (!previous) return { label: current > 0 ? "+100%" : "0%", positive: current >= 0 };
  const pct = Math.round((current - previous) / previous * 100);
  return { label: pct >= 0 ? `+${pct}%` : `${pct}%`, positive: pct >= 0 };
};

/* ── Config ──────────────────────────────────────────── */

const RANGES = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "1y", label: "1 Jahr" },
];

const CARDS = [
  { key: "tenants",   label: "Tenants",         icon: Users,        gradId: "gBlue",   colors: ["#2563eb", "#60a5fa"], href: "/admin/tenants" },
  { key: "published", label: "Veröffentlicht",  icon: FileText,     gradId: "gGreen",  colors: ["#059669", "#34d399"], series: "published" },
  { key: "failed",    label: "Fehlgeschlagen",   icon: AlertCircle,  gradId: "gRed",    colors: ["#dc2626", "#f87171"], series: "failed" },
  { key: "total",     label: "Gesamt Posts",     icon: TrendingUp,   gradId: "gAmber",  colors: ["#d97706", "#fbbf24"], series: "total" },
];

/* ── Main Component ──────────────────────────────────── */

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [range, setRange] = useState("30d");
  const [modal, setModal] = useState(null);
  const [chartMode, setChartMode] = useState("bar");
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    fetch(`/api/admin/dashboard?range=${range}`).then(r => r.json()).then(setData);
  }, [range]);

  const switchRange = (r) => { setRange(r); setAnimKey(k => k + 1); };
  const openModal = (card) => { if (card.href) return; setModal(card); setChartMode("bar"); setAnimKey(k => k + 1); };
  const switchMode = (m) => { setChartMode(m); setAnimKey(k => k + 1); };

  /* ── Skeleton ── */
  if (!data) return (
    <div className="dw-root">
      <div className="dw-hero">
        <div><div className="dw-skel h-4 w-20 mb-2" /><div className="dw-skel h-8 w-48" /></div>
        <div className="dw-skel h-10 w-56 rounded-full" />
      </div>
      <div className="stat-grid">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="stat-card">
            <div className="stat-meta"><div className="stat-icon dw-skel" /><div className="dw-skel h-5 w-12 rounded-full" /></div>
            <div className="dw-skel h-9 w-24" />
            <div className="dw-skel h-3 w-20" />
            <div className="dw-skel h-[60px] w-full" />
          </div>
        ))}
      </div>
      <div className="dw-grid-2">
        <div className="dw-card"><div className="dw-skel h-5 w-24 mb-4" />{[1,2,3].map(i => <div key={i} className="dw-skel h-12 w-full mb-2" />)}</div>
        <div className="dw-card"><div className="dw-skel h-5 w-32 mb-4" />{[1,2,3].map(i => <div key={i} className="dw-skel h-12 w-full mb-2" />)}</div>
      </div>
    </div>
  );

  const getValue = (c) => c.key === "tenants" ? data.stats.tenants : (data.stats.current[c.series] || 0);
  const getPrev  = (c) => c.key === "tenants" ? null : (data.stats.previous[c.series] || 0);
  const getSeries = (c) => c.series ? data.timeSeries.map(d => d[c.series] || 0) : [];

  /* ── Render ── */
  return (
    <div className="dw-root">
      {/* Hero */}
      <div className="dw-hero">
        <div>
          <p className="dw-eyebrow">Ghostwriter</p>
          <h1 className="dw-title">Dashboard</h1>
        </div>
        <div className="pill-group">
          {RANGES.map(r => (
            <button key={r.key} className={`pill-toggle ${range === r.key ? "active" : ""}`}
              onClick={() => switchRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-grid">
        {CARDS.map((card, idx) => {
          const value = getValue(card);
          const prev = getPrev(card);
          const delta = prev !== null ? calcDelta(value, prev) : null;
          const series = getSeries(card);
          const Icon = card.icon;

          const inner = (
            <>
              <div className="stat-meta">
                <span className="stat-icon" style={{ background: `${card.colors[0]}18`, color: card.colors[0] }}>
                  <Icon size={15} />
                </span>
                {delta && (
                  <span className="stat-delta" style={{
                    background: delta.positive ? `${card.colors[0]}20` : "rgba(255,98,98,0.15)",
                    color: delta.positive ? card.colors[0] : "#ff6262",
                  }}>
                    {delta.label}
                  </span>
                )}
              </div>
              <div className="stat-value"><CountUp value={value} delay={idx * 150} /></div>
              <div className="stat-label">{card.label}</div>
              <svg className="stat-chart" viewBox="0 0 120 32" aria-hidden="true">
                <defs>
                  <linearGradient id={card.gradId} x1="0" x2="1">
                    <stop offset="0%" stopColor={card.colors[0]} />
                    <stop offset="100%" stopColor={card.colors[1]} />
                  </linearGradient>
                </defs>
                <polyline
                  points={toPoints(series) || PLACEHOLDER_POINTS}
                  fill="none"
                  stroke={toPoints(series) ? `url(#${card.gradId})` : "hsl(var(--border))"}
                  strokeWidth={toPoints(series) ? "2.5" : "1.5"}
                  strokeLinecap="round"
                  strokeDasharray={toPoints(series) ? undefined : "4 3"}
                  style={toPoints(series) ? {
                    strokeDasharray: 300,
                    strokeDashoffset: 300,
                    animation: `statLineDraw 1.4s ease-out ${0.3 + idx * 0.15}s forwards`,
                  } : { opacity: 0.5 }}
                />
              </svg>
            </>
          );

          if (card.href) {
            return <Link key={card.key} href={card.href} className="stat-card stat-card-link">{inner}</Link>;
          }
          return (
            <div key={card.key} className="stat-card stat-card-link" onClick={() => openModal(card)}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* Two-Column: Tenants + Recent Posts */}
      <div className="dw-grid-2">
        {/* Tenants */}
        <div className="dw-card">
          <div className="dw-card-header">
            <h2><Users size={16} /> Tenants</h2>
            <Link href="/admin/tenants" className="dw-link">Alle <ArrowRight size={14} /></Link>
          </div>
          <div className="dw-list">
            {data.tenants.map(t => (
              <div key={t.id} className="dw-list-item">
                <div>
                  <p className="dw-list-title">{t.name}</p>
                  <p className="dw-list-sub">{t.post_count} Posts</p>
                </div>
                <span className={`dw-badge ${t.autopilot_active ? "dw-badge-success" : ""}`}>
                  {t.autopilot_active ? "Aktiv" : "Pausiert"}
                </span>
              </div>
            ))}
            {data.tenants.length === 0 && (
              <p className="dw-empty">Noch keine Tenants. <Link href="/admin/tenants" className="dw-link">Erstellen</Link></p>
            )}
          </div>
        </div>

        {/* Recent Posts */}
        <div className="dw-card">
          <div className="dw-card-header">
            <h2><Activity size={16} /> Letzte Posts</h2>
            <span className="dw-sub-label">{range === "7d" ? "7 Tage" : range === "30d" ? "30 Tage" : "1 Jahr"}</span>
          </div>
          <div className="dw-list">
            {data.recentPosts.map(p => (
              <div key={p.id} className="dw-list-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="dw-list-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.blog_title || "Ohne Titel"}
                  </p>
                  <p className="dw-list-sub">
                    {p.tenant_name} &middot; {p.language?.toUpperCase()} &middot; {p.category}
                  </p>
                </div>
                <span className={`dw-badge ${p.status === "published" ? "dw-badge-success" : p.status === "failed" ? "dw-badge-error" : ""}`}>
                  {p.status === "published" ? "Live" : p.status === "failed" ? "Fehler" : p.status}
                </span>
              </div>
            ))}
            {data.recentPosts.length === 0 && (
              <p className="dw-empty">Noch keine Posts generiert.</p>
            )}
          </div>
        </div>
      </div>

      {/* Chart Modal */}
      {modal && typeof document !== "undefined" && createPortal(
        <ChartModal
          modal={modal}
          data={data}
          range={range}
          chartMode={chartMode}
          animKey={animKey}
          onSwitchMode={switchMode}
          onClose={() => setModal(null)}
        />,
        document.body
      )}
    </div>
  );
}

/* ── Chart Modal ─────────────────────────────────────── */

function ChartModal({ modal, data, range, chartMode, animKey, onSwitchMode, onClose }) {
  const Icon = modal.icon;
  const series = data.timeSeries.map(d => d[modal.series] || 0);
  const prevSeries = data.prevTimeSeries.map(d => d[modal.series] || 0);

  const labels = data.timeSeries.map(d => {
    const date = new Date(d.date);
    return range === "1y"
      ? date.toLocaleDateString("de", { month: "short" })
      : date.toLocaleDateString("de", { day: "2-digit", month: "2-digit" });
  });

  const total = series.reduce((a, b) => a + b, 0);
  const prevTotal = prevSeries.reduce((a, b) => a + b, 0);
  const delta = calcDelta(total, prevTotal);
  const maxValue = Math.max(...series, ...prevSeries, 1);
  const svgW = Math.max(series.length - 1, 1) * 40;

  return (
    <div className="dw-modal-backdrop" onClick={onClose}>
      <div className="dw-modal dw-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="dw-modal-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon size={20} style={{ color: modal.colors[0] }} />
            {modal.label}
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className={`dw-icon-btn ${chartMode === "bar" ? "active" : ""}`}
              onClick={() => onSwitchMode("bar")} title="Balkendiagramm">
              <BarChart3 size={18} />
            </button>
            <button className={`dw-icon-btn ${chartMode === "line" ? "active" : ""}`}
              onClick={() => onSwitchMode("line")} title="Liniendiagramm">
              <LineChart size={18} />
            </button>
            <button className="dw-icon-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div className="dw-modal-body">
          {/* Legend */}
          <div className="dw-legend">
            <span><span className="dw-legend-dot" style={{ background: modal.colors[0] }} /> Aktuell</span>
            <span><span className="dw-legend-dot dw-legend-dot-prev" /> Vorzeitraum</span>
          </div>

          {/* Chart */}
          {series.length === 0 ? (
            <div className="dw-empty" style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
              Keine Daten für diesen Zeitraum.
            </div>
          ) : chartMode === "bar" ? (
            <div className="dw-bar-chart" key={`bar-${animKey}`}>
              {series.map((val, i) => {
                const hPct = maxValue > 0 ? (val / maxValue) * 100 : 0;
                const prevVal = prevSeries[i] || 0;
                const prevHPct = maxValue > 0 ? (prevVal / maxValue) * 100 : 0;
                return (
                  <div key={i} className="dw-bar-col">
                    <div className="dw-bar-area">
                      <div className="dw-bar-rise anim-rise"
                        style={{ "--bar-h": `${Math.max(hPct, prevHPct)}%`, animationDelay: `${i * 40}ms` }}>
                        {val > 0 && <span className="dw-bar-val">{val}</span>}
                        <div className="dw-bar-pair">
                          <div className="dw-bar dw-bar-current"
                            style={{ height: `${hPct > 0 ? (hPct / Math.max(hPct, prevHPct)) * 100 : 0}%`, background: `linear-gradient(180deg, ${modal.colors[0]}, ${modal.colors[1]}80)` }} />
                          <div className="dw-bar dw-bar-prev"
                            style={{ height: `${prevHPct > 0 ? (prevHPct / Math.max(hPct, prevHPct)) * 100 : 0}%` }} />
                        </div>
                      </div>
                    </div>
                    <span className="dw-bar-label">{labels[i]}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div key={`line-${animKey}`}>
              <svg viewBox={`0 0 ${svgW} 180`} preserveAspectRatio="none" className="dw-line-svg">
                <defs>
                  <linearGradient id="modalGrad" x1="0" x2="1">
                    <stop offset="0%" stopColor={modal.colors[0]} />
                    <stop offset="100%" stopColor={modal.colors[1]} />
                  </linearGradient>
                </defs>
                {prevSeries.length > 0 && (
                  <polyline
                    points={prevSeries.map((v, i) => `${i * 40},${180 - (v / maxValue) * 170}`).join(" ")}
                    fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="2" strokeDasharray="6 4"
                  />
                )}
                <polyline
                  className="dw-line-anim"
                  points={series.map((v, i) => `${i * 40},${180 - (v / maxValue) * 170}`).join(" ")}
                  fill="none" stroke="url(#modalGrad)" strokeWidth="3" strokeLinecap="round"
                  style={{ "--line-len": `${series.length * 50}` }}
                />
              </svg>
            </div>
          )}

          {/* Summary */}
          <div className="dw-summary">
            <span>Gesamt: <strong>{fmtNum(total)}</strong></span>
            <span className="stat-delta" style={{
              background: delta.positive ? `${modal.colors[0]}20` : "rgba(255,98,98,0.15)",
              color: delta.positive ? modal.colors[0] : "#ff6262",
            }}>
              {delta.label}
            </span>
            <span className="text-muted-foreground">vs. {fmtNum(prevTotal)} im Vorzeitraum</span>
          </div>
        </div>
      </div>
    </div>
  );
}
