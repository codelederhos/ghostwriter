"use client";

import { useState, useEffect } from "react";
import { Save } from "lucide-react";

export default function SettingsPage() {
  const [msg, setMsg] = useState(null);
  const [models, setModels] = useState(null);
  const [imageModels, setImageModels] = useState(null);
  const [features, setFeatures] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      setModels(data.recommended_models || {
        anthropic: { model: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", ctx: "200k" },
        openai: { model: "gpt-4.1-mini", label: "GPT-4.1 Mini", ctx: "1M" },
        mistral: { model: "mistral-large-latest", label: "Mistral Large", ctx: "128k" },
      });
      setImageModels(data.image_models || {
        openai: { model: "gpt-image-1", label: "GPT-Image 1", size: "1536x1024" },
        flux: { model: "fal-ai/flux/schnell", label: "Flux Schnell" },
      });
      setFeatures(data.features || { research_enabled: false });
      setPricing(data.pricing || { post_price_cents: 300, backlink_price_cents: 100, membership_monthly_cents: 0 });
    } catch {
      setModels({
        anthropic: { model: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", ctx: "200k" },
        openai: { model: "gpt-4.1-mini", label: "GPT-4.1 Mini", ctx: "1M" },
        mistral: { model: "mistral-large-latest", label: "Mistral Large", ctx: "128k" },
      });
      setImageModels({
        openai: { model: "gpt-image-1", label: "GPT-Image 1", size: "1536x1024" },
        flux: { model: "fal-ai/flux/schnell", label: "Flux Schnell" },
      });
      setFeatures({ research_enabled: false });
      setPricing({ post_price_cents: 300, backlink_price_cents: 100, membership_monthly_cents: 0 });
    }
  }

  async function saveModels() {
    setSaving(true);
    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "recommended_models", value: models }),
    });
    const data = await res.json();
    setMsg(data.ok ? "Modelle gespeichert" : `Fehler: ${data.error}`);
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  }

  const updateModel = (provider, field, value) => {
    setModels({ ...models, [provider]: { ...models[provider], [field]: value } });
  };

  return (
    <div>
      <h1 className="admin-title">Settings</h1>

      <div className="space-y-6">
        {/* Modelle — nebeneinander */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Empfohlene Modelle */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-2">Empfohlene Modelle</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Diese Modelle werden für alle Tenants verwendet. Kunden sehen nur Provider + API Key.
          </p>
          {models && (
            <div className="space-y-3">
              {[
                { key: "anthropic", label: "Anthropic" },
                { key: "openai", label: "OpenAI" },
                { key: "mistral", label: "Mistral" },
              ].map(({ key, label }) => (
                <div key={key} className="grid grid-cols-[120px_1fr_140px_80px] gap-3 items-center">
                  <span className="text-sm font-medium">{label}</span>
                  <input
                    className="form-input text-sm"
                    value={models[key]?.model || ""}
                    onChange={(e) => updateModel(key, "model", e.target.value)}
                    placeholder="model-id"
                  />
                  <input
                    className="form-input text-sm"
                    value={models[key]?.label || ""}
                    onChange={(e) => updateModel(key, "label", e.target.value)}
                    placeholder="Anzeigename"
                  />
                  <input
                    className="form-input text-sm text-center"
                    value={models[key]?.ctx || ""}
                    onChange={(e) => updateModel(key, "ctx", e.target.value)}
                    placeholder="Ctx"
                  />
                </div>
              ))}
              <button onClick={saveModels} className="btn-primary mt-2" disabled={saving}>
                <Save size={14} /> Speichern
              </button>
            </div>
          )}
          {msg && <p className="text-sm mt-3 text-emerald-600">{msg}</p>}
        </div>

        {/* Bild-Modelle */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-2">Bild-Modelle</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Welches Modell wird für Bildgenerierung genutzt. Platform-Mode verwendet OpenAI, Own-Key-Mode den Tenant-Provider.
          </p>
          {imageModels && (
            <div className="space-y-3">
              {[
                { key: "openai", label: "OpenAI Images", placeholder: "z.B. gpt-image-1 oder dall-e-3" },
                { key: "flux", label: "Flux (fal.ai)", placeholder: "z.B. fal-ai/flux/schnell" },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="grid grid-cols-[120px_1fr_120px] gap-2 items-center">
                  <span className="text-sm font-medium">{label}</span>
                  <input
                    className="form-input text-sm font-mono"
                    value={imageModels[key]?.model || ""}
                    onChange={(e) => setImageModels({ ...imageModels, [key]: { ...imageModels[key], model: e.target.value } })}
                    placeholder={placeholder}
                  />
                  <input
                    className="form-input text-sm"
                    value={imageModels[key]?.label || ""}
                    onChange={(e) => setImageModels({ ...imageModels, [key]: { ...imageModels[key], label: e.target.value } })}
                    placeholder="Anzeigename"
                  />
                </div>
              ))}
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                <strong>gpt-image-1</strong> = aktuelles OpenAI-Modell (höchste Qualität) &nbsp;·&nbsp;
                <strong>dall-e-3</strong> = Vorgänger &nbsp;·&nbsp;
                Flux: eigener fal.ai API-Key im Tenant erforderlich
              </div>
              <button onClick={async () => {
                setSaving(true);
                await fetch("/api/admin/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "image_models", value: imageModels }),
                });
                setMsg("Bild-Modelle gespeichert");
                setSaving(false);
                setTimeout(() => setMsg(null), 3000);
              }} className="btn-primary mt-1" disabled={saving}>
                <Save size={14} /> Speichern
              </button>
              {msg === "Bild-Modelle gespeichert" && <p className="text-sm mt-2 text-emerald-600">{msg}</p>}
            </div>
          )}
        </div>
        </div>{/* end grid */}

        {/* Features */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-2">Features (Global)</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Gilt für alle Tenants. Kunden sehen diese Optionen nicht.
          </p>
          {features && (
            <div className="space-y-3">
              <div
                className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  features.research_enabled ? "border-emerald-400 bg-emerald-50" : "border-border hover:border-muted-foreground/30"
                }`}
                onClick={() => setFeatures({ ...features, research_enabled: !features.research_enabled })}
              >
                <div>
                  <p className="font-medium text-sm">Echtzeit-Recherche (Tavily)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Vor dem Schreiben aktuelle Fakten + Quellen recherchieren. Benötigt TAVILY_API_KEY auf dem Server.</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ml-4 ${
                  features.research_enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}>
                  {features.research_enabled ? "Aktiv" : "Inaktiv"}
                </span>
              </div>
              <button onClick={async () => {
                setSaving(true);
                await fetch("/api/admin/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "features", value: features }),
                });
                setMsg("Features gespeichert");
                setSaving(false);
                setTimeout(() => setMsg(null), 3000);
              }} className="btn-primary" disabled={saving}>
                <Save size={14} /> Speichern
              </button>
              {msg === "Features gespeichert" && <p className="text-sm mt-2 text-emerald-600">{msg}</p>}
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-2">Preise (Platform-Modus)</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Diese Preise gelten für Tenants im Platform-Modus (All-Inclusive). Angaben in Cent.
          </p>
          {pricing && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-3">
                <div className="form-group">
                  <label className="form-label">Pro Post (Cent)</label>
                  <input className="form-input text-sm" type="number" value={pricing.post_price_cents || 0}
                    onChange={(e) => setPricing({ ...pricing, post_price_cents: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">{((pricing.post_price_cents || 0) / 100).toFixed(2)} €</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Backlink (Cent)</label>
                  <input className="form-input text-sm" type="number" value={pricing.backlink_price_cents || 0}
                    onChange={(e) => setPricing({ ...pricing, backlink_price_cents: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">{((pricing.backlink_price_cents || 0) / 100).toFixed(2)} €</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Mitglied/Monat (Cent)</label>
                  <input className="form-input text-sm" type="number" value={pricing.membership_monthly_cents || 0}
                    onChange={(e) => setPricing({ ...pricing, membership_monthly_cents: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">{((pricing.membership_monthly_cents || 0) / 100).toFixed(2)} €</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Test-Rabatt (%)</label>
                  <input className="form-input text-sm" type="number" value={pricing.test_discount_percent ?? 60} min={0} max={100}
                    onChange={(e) => setPricing({ ...pricing, test_discount_percent: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">Test-Posts zahlen {100 - (pricing.test_discount_percent ?? 60)}%</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Bild-Regen (Cent)</label>
                  <input className="form-input text-sm" type="number" value={pricing.image_regen_price_cents ?? 100} min={0}
                    onChange={(e) => setPricing({ ...pricing, image_regen_price_cents: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">{((pricing.image_regen_price_cents ?? 100) / 100).toFixed(2)} €</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Refresh-Rabatt (%)</label>
                  <input className="form-input text-sm" type="number" value={pricing.refresh_discount_percent ?? 40} min={0} max={100}
                    onChange={(e) => setPricing({ ...pricing, refresh_discount_percent: parseInt(e.target.value) || 0 })} />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">Refresh kostet {100 - (pricing.refresh_discount_percent ?? 40)}% des Postpreises</p>
                </div>
              </div>
              <button onClick={async () => {
                setSaving(true);
                await fetch("/api/admin/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "pricing", value: pricing }),
                });
                setMsg("Preise gespeichert");
                setSaving(false);
                setTimeout(() => setMsg(null), 3000);
              }} className="btn-primary" disabled={saving}>
                <Save size={14} /> Speichern
              </button>
            </div>
          )}
          {msg === "Preise gespeichert" && <p className="text-sm mt-3 text-emerald-600">{msg}</p>}
        </div>

        {/* Global Scheduler */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-4">Scheduler</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Der Autopilot prüft alle 30 Minuten ob ein Tenant einen neuen Post braucht.
            Die Frequenz pro Tenant wird in den Tenant-Einstellungen konfiguriert.
          </p>
          <div className="flex items-center gap-3">
            <span className="badge-success">Aktiv</span>
            <span className="text-sm text-muted-foreground">Intervall: 30 Minuten (fest)</span>
          </div>
        </div>

        {/* System Info */}
        <div className="admin-card">
          <h2 className="text-lg font-semibold mb-4">System</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Version</p>
              <p className="font-medium">Ghostwriter MVP</p>
            </div>
            <div>
              <p className="text-muted-foreground">Stack</p>
              <p className="font-medium">Next.js 14 + PostgreSQL 16</p>
            </div>
            <div>
              <p className="text-muted-foreground">Server</p>
              <p className="font-medium">Docker (95.111.228.131)</p>
            </div>
            <div>
              <p className="text-muted-foreground">Deploy</p>
              <p className="font-medium">Git Pull + Docker Build</p>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="admin-card border-red-200">
          <h2 className="text-lg font-semibold mb-4 text-red-700">Gefahrenzone</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Globaler Autopilot-Reset: Setzt alle next_run_at Werte zurück, sodass beim nächsten Scheduler-Lauf
            alle aktiven Tenants sofort geprüft werden.
          </p>
          <button
            onClick={async () => {
              const res = await fetch("/api/admin/reset-scheduler", { method: "POST" });
              const data = await res.json();
              setMsg(data.ok ? "Scheduler zurückgesetzt." : `Fehler: ${data.error}`);
            }}
            className="btn-destructive"
          >
            Scheduler zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}
