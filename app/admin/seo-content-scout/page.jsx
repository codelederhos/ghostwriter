"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ExternalLink, Filter, Link2, Megaphone, RefreshCw, Send, ShieldAlert, Target, TrendingUp } from "lucide-react";

const STATUS_LABELS = {
  brief_ready: "Briefing bereit",
  in_review: "in Prüfung",
  draft_requested: "Draft angefordert",
  done: "erledigt",
  ignored: "ignoriert",
};

const TYPE_LABELS = {
  new_blog_article: "Neuer Blog",
  support_article: "Support-Artikel",
  new_landing_page: "Landingpage/Ratgeber",
};

const TYPE_COLORS = {
  new_blog_article: "bg-purple-50 text-purple-700 border-purple-200",
  support_article: "bg-emerald-50 text-emerald-700 border-emerald-200",
  new_landing_page: "bg-amber-50 text-amber-700 border-amber-200",
};

const RISK_COLORS = {
  none: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-blue-50 text-blue-700 border-blue-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

function fmtDate(value) {
  if (!value) return "nie";
  return new Date(value).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

function Pill({ children, tone = "bg-slate-50 text-slate-600 border-slate-200" }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <div className="admin-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon size={15} className="text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function CandidateCard({ item, onStatus }) {
  const typeTone = TYPE_COLORS[item.content_type] || TYPE_COLORS.new_blog_article;
  const riskTone = RISK_COLORS[item.cannibalization_risk] || RISK_COLORS.none;
  const signal = item.signal_summary && typeof item.signal_summary === "object" ? item.signal_summary : {};
  const briefing = item.briefing && typeof item.briefing === "object" ? item.briefing : {};
  const links = Array.isArray(item.internal_links) ? item.internal_links : [];
  const ctas = Array.isArray(item.cta_plan) ? item.cta_plan : [];
  const social = item.social_package && typeof item.social_package === "object" ? item.social_package : {};
  const alternatives = Array.isArray(item.title_alternatives) ? item.title_alternatives : [];

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/25 hover:shadow-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill>{fmtDate(item.week_start)} · Slot {item.slot}</Pill>
            <Pill tone={typeTone}>{TYPE_LABELS[item.content_type] || item.recommendation}</Pill>
            <Pill>{item.tenant_name}</Pill>
            <Pill>{item.score}/100</Pill>
            <Pill tone={riskTone}><ShieldAlert size={12} /> Risiko {item.cannibalization_risk}</Pill>
            {item.telegram_sent_at && <Pill tone="bg-emerald-50 text-emerald-700 border-emerald-200"><Send size={12} /> Telegram</Pill>}
          </div>
          <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{item.primary_query || item.theme || "kein Query-Text"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.target_url && (
            <a href={item.target_url} target="_blank" className="btn-ghost text-xs">
              Signal-Seite <ExternalLink size={13} />
            </a>
          )}
          <select
            value={item.status}
            onChange={(event) => onStatus(item.id, event.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2 text-xs"
          >
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Impressions</p>
          <p className="font-semibold">{fmtNumber(signal.impressions)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Klicks</p>
          <p className="font-semibold">{fmtNumber(signal.clicks)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Analytics</p>
          <p className="font-semibold">{fmtNumber(signal.analytics_visits)} Visits</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Position</p>
          <p className="font-semibold">{signal.best_position ? Number(signal.best_position).toFixed(1).replace(".", ",") : "-"}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Thema</p>
          <p className="truncate font-semibold">{item.city ? `${item.city} · ` : ""}{item.theme}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/15 px-3 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Warum jetzt:</span> {briefing.why_now || item.reason || "Signal erkannt."}
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Ausarbeitung</p>
          <p className="break-words text-sm text-foreground">{briefing.target_intent || "Intent prüfen."}</p>
          {alternatives.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {alternatives.slice(0, 3).map((title) => <li className="break-words" key={title}>{title}</li>)}
            </ul>
          )}
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Link2 size={12} /> Interne Links</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {(links.length ? links : [{ title: "Links im Briefing prüfen", path: "" }]).slice(0, 5).map((link) => (
              link.path ? (
                <a key={`${link.title}-${link.path}`} href={link.path.startsWith("/") && item.tenant_slug === "baur-immobilien" ? `https://immobilienbaur.de${link.path}` : link.path} target="_blank" className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground">
                  <span className="min-w-0 truncate">{link.title || link.path}</span>
                  <ExternalLink size={12} />
                </a>
              ) : <Pill key={link.title}>{link.title}</Pill>
            ))}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">CTA-Plan</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(ctas.length ? ctas : [{ label: "CTA prüfen", position: "Artikel" }]).slice(0, 4).map((cta) => (
              <li className="break-words" key={`${cta.position}-${cta.label}`}><span className="font-medium text-foreground">{cta.position}:</span> {cta.label}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Guardrails</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(briefing.guardrails || ["Keine Kannibalisierung.", "Fakten prüfen."]).slice(0, 4).map((rule) => <li className="break-words" key={rule}>{rule}</li>)}
          </ul>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Megaphone size={12} /> Social/GBP Entwurf</p>
          <p className="break-words text-sm text-muted-foreground">{social.linkedin || "Noch kein Social-Winkel."}</p>
          <p className="mt-2 text-xs font-medium text-amber-700">Nicht gepostet, Freigabe erforderlich.</p>
        </div>
      </div>
    </article>
  );
}

export default function SeoContentScoutPage() {
  const [data, setData] = useState({ tenants: [], candidates: [], weeks: [], stats: [], runs: [] });
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (weekStart) params.set("weekStart", weekStart);
    if (status) params.set("status", status);
    const res = await fetch(`/api/admin/seo-content-scout?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, [tenantId, weekStart, status]);

  const totals = useMemo(() => {
    const rows = data.candidates || [];
    return {
      count: rows.length,
      sent: rows.filter((row) => row.telegram_sent_at).length,
      avgScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.score || 0), 0) / rows.length) : 0,
      tenants: new Set(rows.map((row) => row.tenant_id)).size,
    };
  }, [data.candidates]);

  async function setCandidateStatus(id, nextStatus) {
    setMsg("");
    await fetch("/api/admin/seo-content-scout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus }),
    });
    setMsg("Status gespeichert");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">SEO Opportunity Scout</p>
          <h1 className="admin-title mb-1">Content Scout</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Der Scout verdichtet allgemeine GSC- und Analytics-Signale zu maximal drei freigabefähigen Artikel-Kandidaten pro Tenant und Woche.
          </p>
        </div>
        <button onClick={load} className="btn-ghost self-start text-sm lg:self-auto">
          <RefreshCw size={14} /> Neu laden
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kandidaten" value={totals.count} sub="aktueller Filter" icon={Target} />
        <StatCard label="Telegram" value={totals.sent} sub="bereits gemeldet" icon={Send} />
        <StatCard label="Score" value={`${totals.avgScore}/100`} sub="Durchschnitt" icon={TrendingUp} />
        <StatCard label="Tenants" value={totals.tenants} sub="mit Kandidaten" icon={CheckCircle2} />
      </div>

      <div className="admin-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Filter size={15} /> Filter</div>
        <div className="grid gap-3 md:grid-cols-4">
          <select className="form-input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">Alle Tenants</option>
            {data.tenants?.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
          <select className="form-input" value={weekStart} onChange={(event) => setWeekStart(event.target.value)}>
            <option value="">Alle Wochen</option>
            {data.weeks?.map((week) => <option key={week.week_start} value={week.week_start}>{fmtDate(week.week_start)} · {week.count}</option>)}
          </select>
          <select className="form-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Alle Status</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="flex items-center text-sm text-muted-foreground">{msg}</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="admin-card p-4">
          <h2 className="mb-3 font-semibold">Wochen</h2>
          <div className="space-y-2">
            {data.weeks?.slice(0, 6).map((week) => (
              <button
                key={week.week_start}
                onClick={() => setWeekStart(week.week_start)}
                className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-all hover:border-primary/30 hover:bg-muted/20"
              >
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} /> {fmtDate(week.week_start)}</span>
                <span className="text-muted-foreground">{week.count} Kandidaten · {week.sent} TG</span>
              </button>
            ))}
          </div>
        </div>
        <div className="admin-card p-4">
          <h2 className="mb-3 font-semibold">Letzte Läufe</h2>
          <div className="space-y-2">
            {data.runs?.slice(0, 6).map((run) => (
              <div key={run.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{run.status}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(run.week_start)} · {run.tenants_checked} Tenants</p>
                </div>
                <Pill>{run.candidates_created} Kandidaten · {run.telegram_messages} TG</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="admin-card h-56 animate-pulse bg-muted/30" />)}
        </div>
      ) : data.candidates?.length ? (
        <div className="space-y-3">
          {data.candidates.map((item) => <CandidateCard key={item.id} item={item} onStatus={setCandidateStatus} />)}
        </div>
      ) : (
        <div className="admin-card py-12 text-center text-muted-foreground">Noch keine Content-Scout-Kandidaten für diesen Filter.</div>
      )}
    </div>
  );
}
