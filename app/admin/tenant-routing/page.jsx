"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, Database, ExternalLink, Globe2, MessageCircle, RefreshCw, Save, ServerCog } from "lucide-react";

const STATUS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
};

function badgeClass(ok, hasAudit = true) {
  if (!hasAudit) return STATUS.warn;
  return ok ? STATUS.ok : STATUS.error;
}

function StatusBadge({ ok, children, hasAudit = true }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(ok, hasAudit)}`}>
      {ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {children}
    </span>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        className="form-input font-mono text-xs"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all ${
        checked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-muted-foreground hover:bg-muted/50"
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
      {label}
    </button>
  );
}

function TenantCard({ tenant, onSave }) {
  const [draft, setDraft] = useState({
    project_key: tenant.project_key,
    telegram_route_key: tenant.telegram_route_key,
    analytics_tenant_key: tenant.analytics_tenant_key,
    gsc_site: tenant.gsc_site,
    client_api_url: tenant.client_api_url,
    client_push_enabled: tenant.client_push_enabled,
    telegram_enabled: tenant.telegram_enabled,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      project_key: tenant.project_key,
      telegram_route_key: tenant.telegram_route_key,
      analytics_tenant_key: tenant.analytics_tenant_key,
      gsc_site: tenant.gsc_site,
      client_api_url: tenant.client_api_url,
      client_push_enabled: tenant.client_push_enabled,
      telegram_enabled: tenant.telegram_enabled,
    });
  }, [tenant]);

  const hasAudit = Boolean(tenant.audit?.checked_at);
  const allOk = hasAudit && tenant.audit.route_ok && tenant.audit.analytics_ok && tenant.audit.gsc_ok && tenant.audit.client_ok;
  const changed = JSON.stringify(draft) !== JSON.stringify({
    project_key: tenant.project_key,
    telegram_route_key: tenant.telegram_route_key,
    analytics_tenant_key: tenant.analytics_tenant_key,
    gsc_site: tenant.gsc_site,
    client_api_url: tenant.client_api_url,
    client_push_enabled: tenant.client_push_enabled,
    telegram_enabled: tenant.telegram_enabled,
  });

  async function save() {
    setSaving(true);
    await onSave(tenant.id, draft);
    setSaving(false);
  }

  return (
    <article className="admin-card space-y-5 transition-all hover:border-primary/25 hover:shadow-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{tenant.name}</h2>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">/{tenant.slug}</span>
            <StatusBadge ok={allOk} hasAudit={hasAudit}>{allOk ? "Audit grün" : hasAudit ? "Prüfen" : "Audit offen"}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tenant.domain || "Keine Domain hinterlegt"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/tenants/${tenant.id}`} className="btn-ghost text-sm">
            Tenant öffnen <ExternalLink size={14} />
          </Link>
          <button onClick={save} disabled={!changed || saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Speichern
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><MessageCircle size={14} /> Telegram</div>
          <StatusBadge ok={tenant.audit?.route_ok} hasAudit={hasAudit}>{tenant.telegram_route_key || "Route fehlt"}</StatusBadge>
          <p className="mt-2 text-xs text-muted-foreground">Bot: {tenant.audit?.token_mode || "route-default"}{tenant.has_telegram_token_file ? " · Token-Datei gesetzt" : ""}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Database size={14} /> Analytics</div>
          <StatusBadge ok={tenant.audit?.analytics_ok} hasAudit={hasAudit}>{tenant.analytics_tenant_key || "Tenant fehlt"}</StatusBadge>
          <p className="mt-2 text-xs text-muted-foreground">Quelle wird pro Projekt getrennt gelesen.</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Globe2 size={14} /> GSC</div>
          <StatusBadge ok={tenant.audit?.gsc_ok} hasAudit={hasAudit}>{tenant.gsc_site || "Property fehlt"}</StatusBadge>
          <p className="mt-2 text-xs text-muted-foreground">Property muss in der GSC-Verbindung erreichbar sein.</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><ServerCog size={14} /> Client-API</div>
          <StatusBadge ok={tenant.audit?.client_ok} hasAudit={hasAudit}>{tenant.client_push_enabled ? "Push aktiv" : "Push aus"}</StatusBadge>
          <p className="mt-2 truncate text-xs text-muted-foreground">{tenant.client_api_url || "Keine Client-API"}</p>
        </div>
      </div>

      {tenant.audit?.problems?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {tenant.audit.problems.join(" · ")}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Projekt-Key" value={draft.project_key} onChange={(v) => setDraft((d) => ({ ...d, project_key: v }))} placeholder="baurimmo" />
        <Field label="Telegram-Route" value={draft.telegram_route_key} onChange={(v) => setDraft((d) => ({ ...d, telegram_route_key: v }))} placeholder="baurimmo" />
        <Field label="Analytics-Tenant" value={draft.analytics_tenant_key} onChange={(v) => setDraft((d) => ({ ...d, analytics_tenant_key: v }))} placeholder="baurimmo" />
        <Field label="GSC-Property" value={draft.gsc_site} onChange={(v) => setDraft((d) => ({ ...d, gsc_site: v }))} placeholder="immobilienbaur.de" />
        <Field label="Client-API URL" value={draft.client_api_url} onChange={(v) => setDraft((d) => ({ ...d, client_api_url: v }))} placeholder="https://example.de/api/blog/webhook" />
        <div className="flex flex-wrap items-end gap-2">
          <Toggle checked={draft.client_push_enabled} onChange={(v) => setDraft((d) => ({ ...d, client_push_enabled: v }))} label="Client-Push" />
          <Toggle checked={draft.telegram_enabled} onChange={(v) => setDraft((d) => ({ ...d, telegram_enabled: v }))} label="Telegram-Report" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Keine Secrets sichtbar: Chat-ID, Bot-Token, API-Key und Token-Dateipfad werden nur als Status ausgewertet.
        Audit aktualisieren: <code className="rounded bg-muted px-1 py-0.5">/opt/ghostwriter-tools/tenant_mapping_audit.py --write-db</code>
      </p>
    </article>
  );
}

export default function TenantRoutingPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/tenant-routing", { cache: "no-store" });
    const data = await res.json();
    setTenants(data.tenants || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const total = tenants.length;
    const ok = tenants.filter((t) => t.audit?.checked_at && t.audit.route_ok && t.audit.analytics_ok && t.audit.gsc_ok && t.audit.client_ok).length;
    return { total, ok, open: total - ok };
  }, [tenants]);

  async function saveTenant(tenantId, settings) {
    setMsg(null);
    const res = await fetch("/api/admin/tenant-routing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, settings }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMsg({ type: "error", text: data.error || "Speichern fehlgeschlagen" });
      return;
    }
    setMsg({ type: "success", text: "Mapping gespeichert. Audit nach dem nächsten Check neu grün rechnen." });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Ghostwriter Ops</p>
          <h1 className="admin-title mb-1">Tenant Routing & Analytics</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Pro Tenant wird festgelegt, welcher Telegram-Projektchat, welche Analytics-Datenquelle und welche Search-Console-Property verwendet werden.
          </p>
        </div>
        <button onClick={load} className="btn-ghost self-start text-sm lg:self-auto">
          <RefreshCw size={14} /> Neu laden
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground">Tenants</p>
          <p className="mt-1 text-2xl font-semibold">{stats.total}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground">Audit grün</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{stats.ok}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground">Offen</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{stats.open}</p>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${msg.type === "error" ? STATUS.error : STATUS.ok}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="admin-card h-48 animate-pulse bg-muted/30" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {tenants.map((tenant) => <TenantCard key={tenant.id} tenant={tenant} onSave={saveTenant} />)}
        </div>
      )}
    </div>
  );
}
