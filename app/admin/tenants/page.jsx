"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Trash2, Play } from "lucide-react";

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", domain: "" });
  const [running, setRunning] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { loadTenants(); }, []);

  async function loadTenants() {
    const res = await fetch("/api/tenants");
    const data = await res.json();
    setTenants(data.tenants || []);
    setLoading(false);
  }

  async function createTenant(e) {
    e.preventDefault();
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...form }),
    });
    setForm({ name: "", slug: "", domain: "" });
    setShowCreate(false);
    loadTenants();
  }

  async function deleteTenant(id) {
    setConfirmDelete(null);
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setMsg({ type: "info", text: "Tenant gelöscht." });
    loadTenants();
  }

  async function triggerRun(tenantId) {
    setRunning(tenantId);
    setMsg(null);
    try {
      const res = await fetch("/api/autopilot/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg({ type: "success", text: `Pipeline erfolgreich! ${data.results?.length || 0} Posts erstellt.` });
      } else {
        setMsg({ type: "error", text: `Fehler: ${data.error}` });
      }
    } catch (err) {
      setMsg({ type: "error", text: `Fehler: ${err.message}` });
    }
    setRunning(null);
    loadTenants();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="admin-title mb-0">Tenants</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> Neuer Tenant
        </button>
      </div>

      {/* Inline Feedback */}
      {msg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${
          msg.type === "success" ? "bg-emerald-50 text-emerald-800" :
          msg.type === "error" ? "bg-red-50 text-red-800" :
          "bg-blue-50 text-blue-800"
        }`}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="float-right font-medium hover:opacity-70">&times;</button>
        </div>
      )}

      {/* Delete Confirm Overlay */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-xl p-6 shadow-lg max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Tenant löschen?</h3>
            <p className="text-sm text-muted-foreground mb-4">Alle Posts werden unwiderruflich gelöscht.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost">Abbrechen</button>
              <button onClick={() => deleteTenant(confirmDelete)} className="btn-destructive">Löschen</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="admin-card mb-6">
          <h2 className="font-semibold mb-4">Neuen Tenant erstellen</h2>
          <form onSubmit={createTenant} className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") })}
                placeholder="Baur Immobilien"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Slug</label>
              <input
                className="form-input"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="baur-immobilien"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Domain (optional)</label>
              <input
                className="form-input"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="immobilienbaur.de"
              />
            </div>
            <div className="col-span-3 flex gap-2">
              <button type="submit" className="btn-primary">Erstellen</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">Abbrechen</button>
            </div>
          </form>
        </div>
      )}

      {/* Tenant List */}
      <div className="space-y-3">
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="admin-card flex items-center justify-between animate-pulse">
              <div>
                <div className="h-4 w-40 bg-muted rounded mb-2" />
                <div className="h-3 w-56 bg-muted rounded" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-5 w-14 bg-muted rounded-full" />
                <div className="h-8 w-16 bg-muted rounded-lg" />
              </div>
            </div>
          ))
        ) : tenants.length === 0 ? (
          <div className="admin-card text-center py-12">
            <p className="text-muted-foreground">Noch keine Tenants vorhanden.</p>
          </div>
        ) : tenants.map((t) => (
          <div key={t.id} className="admin-card flex items-center justify-between hover:border-primary/25 hover:shadow-md transition-all cursor-pointer"
            onClick={() => window.location.href = `/admin/tenants/${t.id}`}>
            <div>
              <p className="font-semibold text-foreground">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                /{t.slug} &middot; {t.domain || "Keine Domain"} &middot; {(t.languages || ["de"]).join(", ").toUpperCase()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={t.autopilot_active ? "badge-success" : "badge-neutral"}>
                {t.autopilot_active ? "Aktiv" : "Pausiert"}
              </span>
              <button
                onClick={() => triggerRun(t.id)}
                disabled={running === t.id}
                className="btn-outline text-xs"
                title="Pipeline jetzt ausführen"
              >
                <Play size={14} /> {running === t.id ? "Läuft..." : "Run"}
              </button>
              <button onClick={() => setConfirmDelete(t.id)} className="btn-ghost text-destructive" title="Löschen">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
