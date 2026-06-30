"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, ExternalLink, Filter, Link2, RefreshCw, Send, TrendingUp } from "lucide-react";

const STATUS_LABELS = {
  growing: "wächst",
  watch: "beobachten",
  refresh_needed: "Refresh nötig",
  no_data: "keine Daten",
};

const STATUS_COLORS = {
  growing: "bg-emerald-50 text-emerald-700 border-emerald-200",
  watch: "bg-blue-50 text-blue-700 border-blue-200",
  refresh_needed: "bg-amber-50 text-amber-700 border-amber-200",
  no_data: "bg-slate-50 text-slate-600 border-slate-200",
};

function fmtDate(value) {
  if (!value) return "nie";
  return new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
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

function FeedbackRow({ item }) {
  const statusTone = STATUS_COLORS[item.status] || STATUS_COLORS.watch;
  const topQueries = Array.isArray(item.top_queries) ? item.top_queries : [];
  const links = Array.isArray(item.internal_link_opportunities) ? item.internal_link_opportunities : [];
  const suggestions = Array.isArray(item.refresh_suggestions) ? item.refresh_suggestions : [];
  const social = item.social_gbp_suggestions && typeof item.social_gbp_suggestions === "object" ? item.social_gbp_suggestions : {};
  const liveUrl = item.tenant_slug === "baur-immobilien" && item.asset_path?.startsWith("/")
    ? `https://immobilienbaur.de${item.asset_path}`
    : item.asset_path;

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={statusTone}>{STATUS_LABELS[item.status] || item.status}</Pill>
            <Pill>{item.milestone_days} Tage</Pill>
            <Pill>{item.tenant_name}</Pill>
            {item.telegram_sent_at && <Pill tone="bg-emerald-50 text-emerald-700 border-emerald-200"><Send size={12} /> Telegram</Pill>}
          </div>
          <h2 className="text-base font-semibold text-foreground">{item.asset_title}</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{item.asset_path}</p>
        </div>
        {liveUrl && (
          <a href={liveUrl} target="_blank" className="btn-ghost self-start text-xs">
            Asset <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">GSC Impr.</p>
          <p className="font-semibold">{fmtNumber(item.gsc_impressions_after)}</p>
          <p className="text-xs text-muted-foreground">vorher {fmtNumber(item.gsc_impressions_before)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Klicks</p>
          <p className="font-semibold">{fmtNumber(item.gsc_clicks_after)}</p>
          <p className="text-xs text-muted-foreground">vorher {fmtNumber(item.gsc_clicks_before)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Position</p>
          <p className="font-semibold">{item.gsc_position_after ? Number(item.gsc_position_after).toFixed(1).replace(".", ",") : "-"}</p>
          <p className="text-xs text-muted-foreground">Delta {item.ranking_delta ?? "-"}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Visits</p>
          <p className="font-semibold">{fmtNumber(item.analytics_visits_after)}</p>
          <p className="text-xs text-muted-foreground">Delta {fmtNumber(item.traffic_delta)}</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-[11px] uppercase text-muted-foreground">Auswertung</p>
          <p className="font-semibold">{fmtDate(item.evaluated_at)}</p>
        </div>
      </div>

      {topQueries.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-muted/15 px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Top-Queries</p>
          <div className="flex flex-wrap gap-2">
            {topQueries.slice(0, 5).map((query) => (
              <Pill key={query.query}>{query.query} · {fmtNumber(query.impressions)} Impr.</Pill>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Refresh-Vorschläge</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(suggestions.length ? suggestions : ["Weiter beobachten."]).slice(0, 4).map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Link2 size={12} /> Linkchancen</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(links.length ? links : [{ title: "Noch keine passende Linkchance erkannt.", path: "" }]).slice(0, 4).map((link) => (
              <li key={`${link.title}-${link.path}`} className="break-words">{link.title}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-white px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Social/GBP vorbereitet</p>
          <p className="text-sm text-muted-foreground">{social.linkedin || "Keine Social-Idee."}</p>
          <p className="mt-2 text-xs font-medium text-amber-700">Nicht gepostet, Freigabe erforderlich.</p>
        </div>
      </div>
    </article>
  );
}

export default function SeoFeedbackPage() {
  const [data, setData] = useState({ tenants: [], feedback: [], stats: [], runs: [] });
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState("");
  const [milestone, setMilestone] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (status) params.set("status", status);
    if (milestone) params.set("milestone", milestone);
    const res = await fetch(`/api/admin/seo-feedback?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, [tenantId, status, milestone]);

  const totals = useMemo(() => {
    const rows = data.feedback || [];
    return {
      count: rows.length,
      impressions: rows.reduce((sum, row) => sum + (row.gsc_impressions_after || 0), 0),
      clicks: rows.reduce((sum, row) => sum + (row.gsc_clicks_after || 0), 0),
      visits: rows.reduce((sum, row) => sum + (row.analytics_visits_after || 0), 0),
    };
  }, [data.feedback]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">SEO Feedback Loop</p>
          <h1 className="admin-title mb-1">Asset Feedback</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Veröffentlichte Assets werden nach 7, 14 und 30 Tagen gegen GSC und Analytics geprüft. Social und GBP bleiben Entwürfe bis zur Freigabe.
          </p>
        </div>
        <button onClick={load} className="btn-ghost self-start text-sm lg:self-auto">
          <RefreshCw size={14} /> Neu laden
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Auswertungen" value={totals.count} sub={`${data.stats?.length || 0} Statusgruppen`} icon={CalendarClock} />
        <StatCard label="Impressions" value={fmtNumber(totals.impressions)} sub="nach Veröffentlichung" icon={TrendingUp} />
        <StatCard label="Klicks" value={fmtNumber(totals.clicks)} sub="GSC Fenster" icon={BarChart3} />
        <StatCard label="Analytics Visits" value={fmtNumber(totals.visits)} sub="Asset-Traffic" icon={BarChart3} />
      </div>

      <div className="admin-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Filter size={15} /> Filter</div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="form-input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">Alle Tenants</option>
            {data.tenants?.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
          <select className="form-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Alle Status</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select className="form-input" value={milestone} onChange={(event) => setMilestone(event.target.value)}>
            <option value="">Alle Meilensteine</option>
            <option value="7">7 Tage</option>
            <option value="14">14 Tage</option>
            <option value="30">30 Tage</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="admin-card p-4">
          <h2 className="mb-3 font-semibold">Status</h2>
          <div className="space-y-2">
            {data.stats?.map((stat) => (
              <button
                key={stat.status}
                onClick={() => setStatus(stat.status)}
                className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-all hover:border-primary/30 hover:bg-muted/20"
              >
                <span>{STATUS_LABELS[stat.status] || stat.status}</span>
                <span className="text-muted-foreground">{stat.count} · {fmtNumber(stat.visits)} Visits</span>
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
                  <p className="text-xs text-muted-foreground">{fmtDate(run.finished_at)} · {run.assets_checked} Checks</p>
                </div>
                <Pill>{run.feedback_upserted} neu · {run.telegram_messages} TG</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="admin-card h-44 animate-pulse bg-muted/30" />)}
        </div>
      ) : data.feedback?.length ? (
        <div className="space-y-3">
          {data.feedback.map((item) => <FeedbackRow key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="admin-card py-12 text-center text-muted-foreground">Noch keine Feedback-Auswertungen für diesen Filter.</div>
      )}
    </div>
  );
}
