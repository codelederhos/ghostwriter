"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, CircleDashed, ExternalLink, Filter, RefreshCw, Search, ShieldAlert, Target, TrendingUp } from "lucide-react";

const RECOMMENDATION_LABELS = {
  refresh_existing_page: "Seite stärken",
  support_article: "Support-Artikel",
  new_blog_article: "Neuer Blog",
  new_landing_page: "Landingpage",
  title_optimization: "Titel/Meta",
  social_only: "Social-only",
  ignore_duplicate: "Ignorieren",
};

const TYPE_COLORS = {
  refresh_existing_page: "bg-blue-50 text-blue-700 border-blue-200",
  support_article: "bg-emerald-50 text-emerald-700 border-emerald-200",
  new_blog_article: "bg-purple-50 text-purple-700 border-purple-200",
  new_landing_page: "bg-amber-50 text-amber-700 border-amber-200",
  title_optimization: "bg-cyan-50 text-cyan-700 border-cyan-200",
  social_only: "bg-slate-50 text-slate-600 border-slate-200",
  ignore_duplicate: "bg-red-50 text-red-700 border-red-200",
};

const RISK_LABELS = {
  none: "kein Risiko",
  low: "gering",
  medium: "mittel",
  high: "hoch",
};

const RISK_COLORS = {
  none: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-blue-50 text-blue-700 border-blue-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

function fmtDate(value) {
  if (!value) return "nie";
  return new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function fmtPercent(value) {
  if (value === null || value === undefined) return "0 %";
  const pct = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${pct.toFixed(1).replace(".", ",")} %`;
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

function OpportunityRow({ item, onStatus }) {
  const action = item.content_action || item.recommendation;
  const label = RECOMMENDATION_LABELS[action] || action;
  const tone = TYPE_COLORS[action] || TYPE_COLORS.social_only;
  const risk = item.cannibalization_risk || "none";
  const linkTargets = Array.isArray(item.internal_link_targets) ? item.internal_link_targets : [];
  const liveUrl = item.page?.startsWith("/") && item.tenant_slug === "baur-immobilien"
    ? `https://immobilienbaur.de${item.page}`
    : null;

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/25 hover:shadow-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={tone}>{label}</Pill>
            <Pill>{item.tenant_name}</Pill>
            <Pill>{item.priority_score}/100</Pill>
            <Pill tone={RISK_COLORS[risk] || RISK_COLORS.none}>Risiko {RISK_LABELS[risk] || risk}</Pill>
            {item.reserved_slug_hit && <Pill tone="bg-red-50 text-red-700 border-red-200"><ShieldAlert size={13} /> geschützt</Pill>}
          </div>
          <h2 className="text-base font-semibold text-foreground">{item.query || item.topic || item.page}</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{item.page}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {liveUrl && (
            <a href={liveUrl} target="_blank" className="btn-ghost text-xs">
              Seite <ExternalLink size={13} />
            </a>
          )}
          <select
            value={item.status}
            onChange={(event) => onStatus(item.id, event.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2 text-xs"
          >
            <option value="open">offen</option>
            <option value="in_progress">in Arbeit</option>
            <option value="resolved">erledigt</option>
            <option value="ignored">ignoriert</option>
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Impressions</p>
          <p className="font-semibold">{item.impressions}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Klicks / CTR</p>
          <p className="font-semibold">{item.clicks} · {fmtPercent(item.ctr)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Position</p>
          <p className="font-semibold">{item.position ? Number(item.position).toFixed(1).replace(".", ",") : "-"}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Analytics</p>
          <p className="font-semibold">{item.analytics_visits} Visits</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Asset</p>
          <p className="truncate font-semibold">{item.protected_asset_type || item.matched_asset_type || "Lücke"}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/15 px-3 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.reason || item.opportunity_type}</span>
        {item.matched_asset_title && <> · {item.matched_asset_title}</>}
      </div>

      {linkTargets.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Interne Linkziele</p>
          <div className="flex flex-wrap gap-2">
            {linkTargets.slice(0, 5).map((link) => (
              <a
                key={`${link.path}-${link.title}`}
                href={item.tenant_slug === "baur-immobilien" && link.path?.startsWith("/") ? `https://immobilienbaur.de${link.path}` : link.path}
                target="_blank"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
              >
                <span className="truncate">{link.title || link.path}</span>
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function SeoOpportunitiesPage() {
  const [data, setData] = useState({ tenants: [], opportunities: [], stats: [], runs: [] });
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [status, setStatus] = useState("open");
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (recommendation) params.set("recommendation", recommendation);
    if (status) params.set("status", status);
    const res = await fetch(`/api/admin/seo-opportunities?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, [tenantId, recommendation, status]);

  const totals = useMemo(() => {
    const rows = data.opportunities || [];
    return {
      count: rows.length,
      impressions: rows.reduce((sum, row) => sum + (row.impressions || 0), 0),
      visits: rows.reduce((sum, row) => sum + (row.analytics_visits || 0), 0),
      maxScore: rows.reduce((max, row) => Math.max(max, row.priority_score || 0), 0),
      protectedHits: rows.filter((row) => row.reserved_slug_hit).length,
      highRisk: rows.filter((row) => row.cannibalization_risk === "high").length,
    };
  }, [data.opportunities]);

  async function setOpportunityStatus(id, nextStatus) {
    setMsg("");
    await fetch("/api/admin/seo-opportunities", {
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
          <p className="text-sm font-medium text-primary">SEO Signale</p>
          <h1 className="admin-title mb-1">Opportunities</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            GSC-Queries, Seitenleistung und Analytics-Traffic werden pro Tenant in priorisierte Chancen übersetzt.
          </p>
        </div>
        <button onClick={load} className="btn-ghost self-start text-sm lg:self-auto">
          <RefreshCw size={14} /> Neu laden
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Geladene Chancen" value={totals.count} sub={`${data.stats?.length || 0} Empfehlungstypen`} icon={Target} />
        <StatCard label="Impressions" value={totals.impressions} sub="GSC Zeitraum aus Sync" icon={TrendingUp} />
        <StatCard label="Analytics Visits" value={totals.visits} sub="pro Zielseite gemappt" icon={BarChart3} />
        <StatCard label="Gap-Risiko" value={totals.highRisk} sub={`${totals.protectedHits} geschützte Treffer`} icon={ShieldAlert} />
      </div>

      <div className="admin-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Filter size={15} /> Filter</div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="form-input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">Alle Tenants</option>
            {data.tenants?.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
          <select className="form-input" value={recommendation} onChange={(event) => setRecommendation(event.target.value)}>
            <option value="">Alle Empfehlungen</option>
            {Object.entries(RECOMMENDATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select className="form-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">Offen</option>
            <option value="in_progress">In Arbeit</option>
            <option value="resolved">Erledigt</option>
            <option value="ignored">Ignoriert</option>
            <option value="all">Alle Status</option>
          </select>
        </div>
      </div>

      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="admin-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Search size={15} /> Empfehlungstypen</h2>
          <div className="space-y-2">
            {data.stats?.map((stat) => (
              <button
                key={stat.recommendation}
                onClick={() => setRecommendation(stat.recommendation)}
                className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-all hover:border-primary/30 hover:bg-muted/20"
              >
                <span>{RECOMMENDATION_LABELS[stat.recommendation] || stat.recommendation}</span>
                <span className="text-muted-foreground">{stat.count} · {stat.protected_hits || 0} geschützt</span>
              </button>
            ))}
          </div>
        </div>
        <div className="admin-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CircleDashed size={15} /> Letzte Syncs</h2>
          <div className="space-y-2">
            {data.runs?.slice(0, 6).map((run) => (
              <div key={run.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{run.tenant_name || "Tenant"}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(run.finished_at)} · {run.gsc_rows} GSC · {run.analytics_pages} Analytics</p>
                </div>
                <Pill tone={run.status === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}>
                  {run.status === "success" ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}
                  {run.opportunities_upserted}
                </Pill>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="admin-card h-36 animate-pulse bg-muted/30" />)}
        </div>
      ) : data.opportunities?.length ? (
        <div className="space-y-3">
          {data.opportunities.map((item) => <OpportunityRow key={item.id} item={item} onStatus={setOpportunityStatus} />)}
        </div>
      ) : (
        <div className="admin-card py-12 text-center text-muted-foreground">Keine Opportunities für diesen Filter.</div>
      )}
    </div>
  );
}
