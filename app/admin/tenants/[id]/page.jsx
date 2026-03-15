"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Save, Play, ArrowLeft, Trash2, GripVertical, Plus, ChevronDown, ChevronRight, FlaskConical, Shuffle, X } from "lucide-react";
import Link from "next/link";

const DEFAULT_ANGLES = [
  { key: 1, label: "Zahlenfakt / Rechenbeispiel", active: true },
  { key: 2, label: "Kundenperspektive / Testimonial", active: true },
  { key: 3, label: "FAQ / Frage-Antwort", active: true },
  { key: 4, label: "Vergleich / Andere vs. Wir", active: true },
  { key: 5, label: "Tipp / Actionable Advice", active: true },
];

export default function TenantDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [tenant, setTenant] = useState(null);
  const [settings, setSettings] = useState({});
  const [profile, setProfile] = useState({});
  const [topics, setTopics] = useState([]);
  const [tab, setTab] = useState("profile");
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", name: "", password: "" });
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [dragItem, setDragItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [hoverDelete, setHoverDelete] = useState(null); // { type: "cat"|"angle", catIdx, angleIdx? }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, catIdx, angleIdx?, label }
  const [lastDeleteAt, setLastDeleteAt] = useState(0); // 3s-Regel Timer
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showTestModal, setShowTestModal] = useState(false);
  const [testMode, setTestMode] = useState("random"); // "random" | "manual"
  const [testCatIdx, setTestCatIdx] = useState(0);
  const [testAngleIdx, setTestAngleIdx] = useState(0);
  const [testRunning, setTestRunning] = useState(false);
  const [modelLabels, setModelLabels] = useState({});

  useEffect(() => { loadTenant(); loadModelLabels(); }, [id]);

  async function loadModelLabels() {
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      const labels = {};
      for (const [k, v] of Object.entries(data.recommended_models || {})) {
        labels[k] = `${v.label} (${v.ctx})`;
      }
      setModelLabels(labels);
    } catch { /* fallback below */ }
  }

  async function loadTenant() {
    const res = await fetch(`/api/tenants/${id}`);
    const data = await res.json();
    setTenant(data.tenant);
    setSettings(data.settings || {});
    setProfile(data.profile || {});
    setTopics(data.topics || []);
  }

  async function saveSettings() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_settings", tenantId: id, settings }),
    });
    setMsg("Settings gespeichert");
    setSaving(false);
  }

  async function saveProfile() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_profile", tenantId: id, profile }),
    });
    setMsg("Profil gespeichert");
    setSaving(false);
  }

  async function saveTopics() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_topics", tenantId: id, topics }),
    });
    setMsg("Themen gespeichert");
    setSaving(false);
  }

  async function loadUsers() {
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_users", tenantId: id }),
    });
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function createCustomerUser() {
    if (!newUser.email || !newUser.password) return;
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_user", tenantId: id, ...newUser }),
    });
    const data = await res.json();
    if (data.ok) {
      setNewUser({ email: "", name: "", password: "" });
      setMsg("Zugang erstellt");
      loadUsers();
    } else {
      setMsg(data.error || "Fehler");
    }
    setSaving(false);
  }

  async function deleteCustomerUser(userId) {
    setSaving(true);
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_user", userId }),
    });
    setMsg("Zugang gelöscht");
    loadUsers();
    setSaving(false);
  }

  async function triggerRun(preview = false, override = null, isTest = false) {
    setMsg("Pipeline wird ausgeführt...");
    const res = await fetch("/api/autopilot/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: id, preview, override, isTest }),
    });
    const data = await res.json();
    if (data.ok) {
      const r = data.results?.[0];
      setMsg(r?.error ? `Fehler: ${r.error}` : `Fertig! "${r?.title || "Post"}" erstellt (${r?.status})`);
    } else {
      setMsg(`Fehler: ${data.error}`);
    }
  }

  async function runTestPost() {
    setTestRunning(true);
    const override = testMode === "random" ? {} : { categoryIndex: testCatIdx, angleIndex: testAngleIdx };
    await triggerRun(true, override, true);
    setTestRunning(false);
    setShowTestModal(false);
  }

  if (!tenant) return (
    <div className="animate-pulse">
      <div className="h-4 w-20 bg-muted rounded mb-4" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-7 w-48 bg-muted rounded mb-2" />
          <div className="h-4 w-24 bg-muted rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-muted rounded-lg" />
          <div className="h-9 w-28 bg-muted rounded-lg" />
        </div>
      </div>
      <div className="flex gap-1 mb-6 border-b border-border">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 w-24 bg-muted rounded mb-1 mx-0.5" />)}
      </div>
      <div className="admin-card space-y-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-muted rounded" />)}
      </div>
    </div>
  );

  const tabs = [
    { key: "profile", label: "Firmenprofil" },
    { key: "settings", label: "API & Provider" },
    { key: "ctas", label: "CTAs" },
    { key: "topics", label: "Themen" },
    { key: "reporting", label: "Reporting" },
    { key: "scheduling", label: "Scheduling" },
    { key: "users", label: "Zugänge" },
  ];

  return (
    <div>
      <Link href="/admin/tenants" className="btn-ghost text-sm mb-4 inline-flex">
        <ArrowLeft size={14} /> Zurück
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTestModal(true)} className="btn-outline"><FlaskConical size={14} /> Test-Post</button>
          <button onClick={() => triggerRun(true)} className="btn-outline"><Play size={14} /> Vorschau</button>
          <button onClick={() => triggerRun(false)} className="btn-primary"><Play size={14} /> Jetzt posten</button>
        </div>
      </div>

      {msg && <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-800 text-sm">{msg}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key === "users") loadUsers(); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Profile */}
      {tab === "profile" && (
        <div className="admin-card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Firmenname" value={profile.company_name} onChange={(v) => setProfile({ ...profile, company_name: v })} />
            <FormField label="Branche" value={profile.industry} onChange={(v) => setProfile({ ...profile, industry: v })} placeholder="Immobilien" />
            <FormField label="Region" value={profile.region} onChange={(v) => setProfile({ ...profile, region: v })} placeholder="Nordhessen" />
            <FormField label="Website" value={profile.website_url} onChange={(v) => setProfile({ ...profile, website_url: v })} placeholder="https://..." />
          </div>
          <FormField label="USP" value={profile.usp} onChange={(v) => setProfile({ ...profile, usp: v })} textarea />
          <FormField label="Positionierung" value={profile.positioning} onChange={(v) => setProfile({ ...profile, positioning: v })} textarea />
          <FormField label="Leistungen" value={profile.services} onChange={(v) => setProfile({ ...profile, services: v })} textarea />
          <FormField label="Brand Voice" value={profile.brand_voice} onChange={(v) => setProfile({ ...profile, brand_voice: v })} placeholder="professionell, nahbar" />
          <FormField label="Zielgruppe" value={profile.target_audience} onChange={(v) => setProfile({ ...profile, target_audience: v })} textarea />
          <FormField label="Sprachen (kommagetrennt)" value={(profile.languages || []).join(", ")} onChange={(v) => setProfile({ ...profile, languages: v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} placeholder="de, en, fr" />
          <button onClick={saveProfile} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: CTAs */}
      {tab === "ctas" && (
        <div className="admin-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Call-to-Actions</h3>
            <button
              onClick={() => {
                const ctas = [...(profile.ctas || [])];
                ctas.push({ key: `CTA_${Date.now()}`, label: "", type: "link", channels: [{ type: "url", label: "", value: "" }] });
                setProfile({ ...profile, ctas });
              }}
              className="btn-outline text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400"
            >
              <Plus size={12} /> CTA
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Definiere die verfügbaren CTAs für diesen Kunden. Diese werden in den Themen-Kategorien als Auswahl angezeigt.
          </p>
          <div className="space-y-3">
            {(profile.ctas || []).map((cta, ci) => (
              <div key={ci} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                <div className="grid grid-cols-[1fr_140px_28px] gap-2 items-center mb-2">
                  <input
                    className="form-input text-sm"
                    value={cta.label}
                    onChange={(e) => {
                      const ctas = [...(profile.ctas || [])];
                      ctas[ci] = { ...ctas[ci], label: e.target.value, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "_") || ctas[ci].key };
                      setProfile({ ...profile, ctas });
                    }}
                    placeholder="CTA-Name (z.B. Anrufen)"
                  />
                  <select
                    className="form-select text-sm"
                    value={cta.type}
                    onChange={(e) => {
                      const ctas = [...(profile.ctas || [])];
                      ctas[ci] = { ...ctas[ci], type: e.target.value };
                      setProfile({ ...profile, ctas });
                    }}
                  >
                    <option value="phone">Telefon</option>
                    <option value="email">E-Mail</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="link">Link/Website</option>
                    <option value="social">Social Media</option>
                  </select>
                  <button
                    className="dw-icon-btn-destructive"
                    onClick={() => {
                      const ctas = [...(profile.ctas || [])];
                      ctas.splice(ci, 1);
                      setProfile({ ...profile, ctas });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="space-y-1.5 ml-2">
                  {(cta.channels || []).map((ch, chi) => (
                    <div key={chi} className="grid grid-cols-[100px_1fr_28px] gap-2 items-center">
                      <input
                        className="form-input text-xs"
                        value={ch.label}
                        onChange={(e) => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels[chi] = { ...channels[chi], label: e.target.value };
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                        placeholder="Bezeichnung"
                      />
                      <input
                        className="form-input text-xs"
                        value={ch.value}
                        onChange={(e) => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels[chi] = { ...channels[chi], value: e.target.value };
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                        placeholder={cta.type === "phone" ? "0561 123456" : cta.type === "email" ? "info@firma.de" : cta.type === "whatsapp" ? "+49..." : "https://..."}
                      />
                      <button
                        className="dw-icon-btn-destructive"
                        onClick={() => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels.splice(chi, 1);
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const ctas = [...(profile.ctas || [])];
                      const channels = [...(ctas[ci].channels || [])];
                      channels.push({ type: cta.type, label: "", value: "" });
                      ctas[ci] = { ...ctas[ci], channels };
                      setProfile({ ...profile, ctas });
                    }}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1 mt-1"
                  >
                    <Plus size={10} /> Kanal hinzufügen
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={saveProfile} className="btn-primary mt-4" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Settings (API Keys) */}
      {tab === "settings" && (
        <div className="admin-card space-y-6">
          <div>
            <h3 className="font-semibold mb-3">Text-Modell</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select className="form-select" value={settings.text_provider || "anthropic"} onChange={(e) => setSettings({ ...settings, text_provider: e.target.value })}>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="mistral">Mistral</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Modell</label>
                <p className="form-input bg-muted/30 text-muted-foreground cursor-default">
                  {modelLabels[settings.text_provider || "anthropic"] || "Auto"}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Gepflegt unter Settings → Empfohlene Modelle</p>
              </div>
            </div>
            <FormField label="API Key" value={settings.text_api_key} onChange={(v) => setSettings({ ...settings, text_api_key: v })} placeholder="sk-..." type="password" />
            {settings.text_provider === "custom" && (
              <FormField label="Custom Endpoint" value={settings.text_custom_endpoint} onChange={(v) => setSettings({ ...settings, text_custom_endpoint: v })} placeholder="https://..." />
            )}
          </div>

          <hr className="border-border" />

          <div>
            <h3 className="font-semibold mb-3">Bild-Modell</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select className="form-select" value={settings.image_provider || "dalle3"} onChange={(e) => setSettings({ ...settings, image_provider: e.target.value })}>
                  <option value="dalle3">DALL-E 3 (OpenAI)</option>
                  <option value="flux">Flux (fal.ai)</option>
                  <option value="stock">Stock (Unsplash/Pexels)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <FormField label="Bild API Key" value={settings.image_api_key} onChange={(v) => setSettings({ ...settings, image_api_key: v })} type="password" />
            </div>
            <FormField label="Bild-Stil Prefix" value={settings.image_style_prefix} onChange={(v) => setSettings({ ...settings, image_style_prefix: v })} textarea placeholder="Fotorealistisch, professionell, keine KI-Gesichter..." />
          </div>

          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Topics */}
      {tab === "topics" && (() => {
        const activeCategories = topics.filter(t => t.is_active !== false).length;
        const activeAngles = topics.reduce((sum, t) => sum + ((t.angles || DEFAULT_ANGLES).filter(a => a.active !== false).length), 0);
        const avgAngles = activeCategories > 0 ? Math.round(activeAngles / activeCategories) : 5;
        const combos = activeCategories * avgAngles * 4;
        const freqDays = settings.frequency_hours ? settings.frequency_hours / 24 : 3;
        const years = Math.floor(combos * freqDays / 365 * 10) / 10;

        const handleCatDragStart = (i) => setDragItem({ type: "cat", catIdx: i });
        const handleCatDragOver = (e, i) => {
          e.preventDefault();
          if (!dragItem) return;
          if (dragItem.type === "cat" && dragItem.catIdx === i) return;
          if (dragItem.type === "angle" && dragItem.catIdx === i) return;
          setDropTarget({ type: dragItem.type === "angle" ? "angle-on-cat" : "cat", catIdx: i });
        };
        const handleCatDrop = (i) => {
          if (!dragItem) return;
          if (dragItem.type === "angle") {
            // Angle auf Kategorie-Header droppen → ans Ende einfügen
            const n = [...topics];
            const srcAngles = [...(n[dragItem.catIdx].angles || DEFAULT_ANGLES)];
            const [moved] = srcAngles.splice(dragItem.angleIdx, 1);
            n[dragItem.catIdx].angles = srcAngles.map((a, idx) => ({ ...a, key: idx + 1 }));
            const dstAngles = [...(n[i].angles || DEFAULT_ANGLES)];
            dstAngles.push(moved);
            n[i].angles = dstAngles.map((a, idx) => ({ ...a, key: idx + 1 }));
            setTopics(n);
            setDragItem(null);
            setDropTarget(null);
            return;
          }
          if (dragItem.type !== "cat") return;
          const n = [...topics];
          const [moved] = n.splice(dragItem.catIdx, 1);
          n.splice(i, 0, moved);
          n.forEach((t, idx) => t.category_id = idx);
          setTopics(n);
          setDragItem(null);
          setDropTarget(null);
        };

        const handleAngleDragStart = (catIdx, angleIdx) => setDragItem({ type: "angle", catIdx, angleIdx });
        const handleAngleDragOver = (e, catIdx, angleIdx) => {
          e.preventDefault();
          if (!dragItem || dragItem.type !== "angle") return;
          setDropTarget({ type: "angle", catIdx, angleIdx });
        };
        const handleAngleDrop = (targetCatIdx, targetAngleIdx) => {
          if (!dragItem || dragItem.type !== "angle") return;
          const n = [...topics];
          const srcAngles = [...(n[dragItem.catIdx].angles || DEFAULT_ANGLES)];
          const [moved] = srcAngles.splice(dragItem.angleIdx, 1);
          if (dragItem.catIdx === targetCatIdx) {
            srcAngles.splice(targetAngleIdx, 0, moved);
            n[targetCatIdx].angles = srcAngles.map((a, i) => ({ ...a, key: i + 1 }));
          } else {
            n[dragItem.catIdx].angles = srcAngles.map((a, i) => ({ ...a, key: i + 1 }));
            const dstAngles = [...(n[targetCatIdx].angles || DEFAULT_ANGLES)];
            dstAngles.splice(targetAngleIdx, 0, moved);
            n[targetCatIdx].angles = dstAngles.map((a, i) => ({ ...a, key: i + 1 }));
          }
          setTopics(n);
          setDragItem(null);
          setDropTarget(null);
        };

        const handleDragEnd = () => { setDragItem(null); setDropTarget(null); };

        const addAngle = (catIdx) => {
          const n = [...topics];
          const angles = [...(n[catIdx].angles || DEFAULT_ANGLES)];
          angles.push({ key: angles.length + 1, label: "", active: true });
          n[catIdx].angles = angles;
          setTopics(n);
        };

        const removeAngle = (catIdx, angleIdx) => {
          const n = [...topics];
          const angles = [...(n[catIdx].angles || DEFAULT_ANGLES)];
          angles.splice(angleIdx, 1);
          n[catIdx].angles = angles.map((a, i) => ({ ...a, key: i + 1 }));
          setTopics(n);
        };

        return (
          <div className="admin-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Themen-Kategorien</h3>
              <button
                onClick={() => setTopics([...topics, { category_id: topics.length, label: "", description: "", default_cta: "LEARN_MORE", is_active: true, angles: [...DEFAULT_ANGLES] }])}
                className="btn-outline text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400"
              >
                <Plus size={12} /> Kategorie
              </button>
            </div>

            {/* Coverage */}
            <div className="mb-4 px-3 py-2 rounded-lg bg-muted/50 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><strong className="text-foreground">{activeCategories}</strong> Kat.</span>
              <span>×</span>
              <span><strong className="text-foreground">{avgAngles}</strong> Angles</span>
              <span>×</span>
              <span><strong className="text-foreground">4</strong> Saisons</span>
              <span>=</span>
              <span className="text-emerald-600 font-medium">{combos} Kombinationen (~{years} J.)</span>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-[24px_24px_1fr_2fr_120px_28px] gap-2 px-2 pb-2 border-b border-border text-xs font-medium text-muted-foreground">
              <span></span>
              <span>#</span>
              <span>Kategorie</span>
              <span>Beschreibung</span>
              <span>CTA</span>
              <span></span>
            </div>

            {/* Category List */}
            <div className="divide-y divide-border/30">
              {topics.map((t, i) => {
                const isExpanded = expandedTopic === i;
                const angles = t.angles || DEFAULT_ANGLES;
                const isDragOverCat = (dropTarget?.type === "cat" || dropTarget?.type === "angle-on-cat") && dropTarget.catIdx === i;
                return (
                  <div key={i}
                    onDragOver={(e) => handleCatDragOver(e, i)}
                    onDrop={() => handleCatDrop(i)}
                  >
                    {/* Category Row */}
                    <div
                      className={`grid grid-cols-[24px_24px_1fr_2fr_120px_28px] gap-2 items-center px-2 py-2.5 rounded-lg transition-all ${
                        hoverDelete?.type === "cat" && hoverDelete.catIdx === i
                          ? "bg-red-50 ring-1 ring-red-200"
                          : isDragOverCat
                            ? "bg-emerald-50 ring-2 ring-emerald-400 ring-inset"
                            : dragItem?.type === "cat" && dragItem.catIdx === i ? "opacity-40" : "hover:bg-muted/30"
                      }`}
                      draggable
                      onDragStart={() => handleCatDragStart(i)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground" data-drag-handle>
                        <GripVertical size={14} />
                      </span>
                      <button
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
                        onClick={() => setExpandedTopic(isExpanded ? null : i)}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {i}
                      </button>
                      <input
                        className="form-input text-sm"
                        value={t.label}
                        onChange={(e) => { const n = [...topics]; n[i].label = e.target.value; setTopics(n); }}
                        placeholder="Kategorie"
                      />
                      <input
                        className="form-input text-sm"
                        value={t.description}
                        onChange={(e) => { const n = [...topics]; n[i].description = e.target.value; setTopics(n); }}
                        placeholder="Beschreibung"
                      />
                      <select
                        className="form-select text-sm"
                        value={t.default_cta}
                        onChange={(e) => { const n = [...topics]; n[i].default_cta = e.target.value; setTopics(n); }}
                      >
                        {(profile.ctas || [{ key: "LEARN_MORE", label: "Mehr erfahren" }, { key: "CALL", label: "Anrufen" }]).map((cta) => (
                          <option key={cta.key} value={cta.key}>{cta.label}</option>
                        ))}
                      </select>
                      <button
                        className="dw-icon-btn-destructive"
                        onMouseEnter={() => setHoverDelete({ type: "cat", catIdx: i })}
                        onMouseLeave={() => setHoverDelete(null)}
                        onClick={() => {
                          if (Date.now() - lastDeleteAt < 3000) {
                            setTopics(topics.filter((_, j) => j !== i));
                            if (isExpanded) setExpandedTopic(null);
                            setLastDeleteAt(Date.now());
                          } else {
                            setDeleteConfirm({ type: "cat", catIdx: i, label: t.label || `Kategorie ${i}` });
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Expanded: Angles */}
                    {isExpanded && (
                      <div className="ml-10 mr-2 mb-3 mt-0.5 p-3 rounded-lg border border-border/50 bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-muted-foreground">Angles (Blickwinkel)</p>
                          <button onClick={() => addAngle(i)} className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1">
                            <Plus size={11} /> Angle
                          </button>
                        </div>
                        <div className="space-y-1">
                          {angles.map((angle, ai) => {
                            const isDragOverAngle = dropTarget?.type === "angle" && dropTarget.catIdx === i && dropTarget.angleIdx === ai;
                            return (
                              <div
                                key={ai}
                                className={`flex items-center gap-2 py-1 px-1 rounded transition-all ${
                                  hoverDelete?.type === "angle" && hoverDelete.catIdx === i && hoverDelete.angleIdx === ai
                                    ? "bg-red-50 ring-1 ring-red-200"
                                    : isDragOverAngle ? "border-t-2 border-emerald-400" : ""
                                } ${dragItem?.type === "angle" && dragItem.catIdx === i && dragItem.angleIdx === ai ? "opacity-40" : "hover:bg-muted/30"}`}
                                draggable
                                onDragStart={(e) => { e.stopPropagation(); handleAngleDragStart(i, ai); }}
                                onDragOver={(e) => { e.stopPropagation(); handleAngleDragOver(e, i, ai); }}
                                onDrop={(e) => { e.stopPropagation(); handleAngleDrop(i, ai); }}
                                onDragEnd={handleDragEnd}
                              >
                                <span className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground">
                                  <GripVertical size={12} />
                                </span>
                                <input
                                  type="checkbox"
                                  checked={angle.active !== false}
                                  onChange={() => {
                                    const n = [...topics];
                                    const a = [...(n[i].angles || DEFAULT_ANGLES)];
                                    a[ai] = { ...a[ai], active: !a[ai].active };
                                    n[i].angles = a;
                                    setTopics(n);
                                  }}
                                  className="rounded border-border"
                                />
                                <span className="text-xs text-muted-foreground w-4 text-center">{angle.key}</span>
                                <input
                                  className="form-input text-sm flex-1"
                                  value={angle.label}
                                  onChange={(e) => {
                                    const n = [...topics];
                                    const a = [...(n[i].angles || DEFAULT_ANGLES)];
                                    a[ai] = { ...a[ai], label: e.target.value };
                                    n[i].angles = a;
                                    setTopics(n);
                                  }}
                                  placeholder="Angle-Bezeichnung"
                                />
                                <button
                                  className="dw-icon-btn-destructive"
                                  onMouseEnter={() => setHoverDelete({ type: "angle", catIdx: i, angleIdx: ai })}
                                  onMouseLeave={() => setHoverDelete(null)}
                                  onClick={() => {
                                    if (Date.now() - lastDeleteAt < 3000) {
                                      removeAngle(i, ai);
                                      setLastDeleteAt(Date.now());
                                    } else {
                                      setDeleteConfirm({ type: "angle", catIdx: i, angleIdx: ai, label: angle.label || `Angle ${ai + 1}` });
                                    }
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 mt-2 italic">
                          Saison wird automatisch erkannt. Angles können per Drag & Drop zwischen Kategorien verschoben werden.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={saveTopics} className="btn-primary mt-4" disabled={saving}><Save size={14} /> Speichern</button>

            {/* Delete Confirm Modal */}
            {deleteConfirm && (
              <div className="dw-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
                <div className="dw-modal" style={{ width: "min(380px, 90vw)" }}>
                  <div className="dw-modal-header">
                    <h2>Wirklich löschen?</h2>
                    <button className="dw-icon-btn" onClick={() => setDeleteConfirm(null)}>&times;</button>
                  </div>
                  <div className="dw-modal-body">
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong className="text-foreground">{deleteConfirm.label}</strong> wird unwiderruflich entfernt.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button className="btn-outline" onClick={() => setDeleteConfirm(null)}>Abbrechen</button>
                      <button className="btn-destructive" onClick={() => {
                        if (deleteConfirm.type === "cat") {
                          setTopics(topics.filter((_, j) => j !== deleteConfirm.catIdx));
                          if (expandedTopic === deleteConfirm.catIdx) setExpandedTopic(null);
                        } else {
                          removeAngle(deleteConfirm.catIdx, deleteConfirm.angleIdx);
                        }
                        setLastDeleteAt(Date.now());
                        setDeleteConfirm(null);
                        setHoverDelete(null);
                      }}>Löschen</button>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60 mt-3 text-center italic">
                      Nach Bestätigung: weitere Löschungen innerhalb 3s ohne Nachfrage
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tab: Reporting */}
      {tab === "reporting" && (
        <div className="admin-card space-y-4">
          <h3 className="font-semibold">Telegram</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Bot Token" value={settings.telegram_bot_token} onChange={(v) => setSettings({ ...settings, telegram_bot_token: v })} type="password" />
            <FormField label="Chat ID" value={settings.telegram_chat_id} onChange={(v) => setSettings({ ...settings, telegram_chat_id: v })} />
          </div>
          <hr className="border-border" />
          <h3 className="font-semibold">E-Mail</h3>
          <FormField label="Report E-Mail" value={settings.report_email} onChange={(v) => setSettings({ ...settings, report_email: v })} placeholder="info@beispiel.de" />
          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Zugänge */}
      {tab === "users" && (
        <div className="admin-card space-y-6">
          <div>
            <h3 className="font-semibold mb-3">Neuen Zugang anlegen</h3>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="E-Mail" value={newUser.email} onChange={(v) => setNewUser({ ...newUser, email: v })} placeholder="kunde@beispiel.de" />
              <FormField label="Name (optional)" value={newUser.name} onChange={(v) => setNewUser({ ...newUser, name: v })} placeholder="Max Mustermann" />
              <FormField label="Passwort" value={newUser.password} onChange={(v) => setNewUser({ ...newUser, password: v })} type="password" />
            </div>
            <button onClick={createCustomerUser} className="btn-primary mt-3" disabled={saving || !newUser.email || !newUser.password}>
              Zugang erstellen
            </button>
          </div>
          <hr className="border-border" />
          <div>
            <h3 className="font-semibold mb-3">Bestehende Zugänge</h3>
            {users.length > 0 ? (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-3 px-4 rounded-lg bg-muted/30">
                    <div>
                      <p className="font-medium text-sm">{u.email}</p>
                      <p className="text-xs text-muted-foreground">{u.name || "Kein Name"} &middot; Erstellt: {new Date(u.created_at).toLocaleDateString("de")}</p>
                    </div>
                    <button onClick={() => deleteCustomerUser(u.id)} className="dw-icon-btn-destructive">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Noch keine Kundenzugänge angelegt.</p>
            )}
          </div>
        </div>
      )}

      {/* Test-Post Modal */}
      {showTestModal && (
        <div className="dw-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowTestModal(false); }}>
          <div className="dw-modal" style={{ width: "min(480px, 90vw)", position: "relative" }}>
            <button className="dw-icon-btn" onClick={() => setShowTestModal(false)} style={{ position: "absolute", top: 12, right: 12 }}>
              <X size={16} />
            </button>
            <div className="p-5">
              <h2 className="text-lg font-semibold mb-1">Test-Post erstellen</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Test-Posts werden als Draft gespeichert und zählen nicht für die Duplikat-Vermeidung.
              </p>

              {/* Mode Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    testMode === "random" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setTestMode("random")}
                >
                  <Shuffle size={14} /> Zufällig
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    testMode === "manual" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setTestMode("manual")}
                >
                  Manuell wählen
                </button>
              </div>

              {testMode === "manual" && (
                <div className="space-y-3 mb-4">
                  <div className="form-group">
                    <label className="form-label">Kategorie</label>
                    <select
                      className="form-select"
                      value={testCatIdx}
                      onChange={(e) => { setTestCatIdx(parseInt(e.target.value)); setTestAngleIdx(0); }}
                    >
                      {topics.filter(t => t.is_active !== false).map((t, i) => (
                        <option key={i} value={i}>{t.label || `Kategorie ${i}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Angle</label>
                    <select className="form-select" value={testAngleIdx} onChange={(e) => setTestAngleIdx(parseInt(e.target.value))}>
                      {(topics.filter(t => t.is_active !== false)[testCatIdx]?.angles || DEFAULT_ANGLES)
                        .filter(a => a.active !== false)
                        .map((a, i) => (
                          <option key={i} value={i}>{a.label}</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              <button
                onClick={runTestPost}
                disabled={testRunning}
                className="btn-primary w-full"
              >
                {testRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Wird generiert...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <FlaskConical size={14} />
                    {testMode === "random" ? "Zufälligen Test-Post erstellen" : "Test-Post erstellen"}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Scheduling */}
      {tab === "scheduling" && (
        <div className="admin-card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="form-label">Frequenz (Stunden)</label>
              <input
                type="number"
                className="form-input"
                value={settings.frequency_hours || 72}
                onChange={(e) => setSettings({ ...settings, frequency_hours: parseInt(e.target.value) })}
                min={1}
              />
              <p className="text-xs text-muted-foreground mt-1">72 = alle 3 Tage</p>
            </div>
            <div className="form-group">
              <label className="form-label">Autopilot aktiv</label>
              <select
                className="form-select"
                value={settings.is_active ? "true" : "false"}
                onChange={(e) => setSettings({ ...settings, is_active: e.target.value === "true" })}
              >
                <option value="true">Aktiv</option>
                <option value="false">Pausiert</option>
              </select>
            </div>
          </div>
          {settings.next_run_at && (
            <p className="text-sm text-muted-foreground">
              Nächster Run: {new Date(settings.next_run_at).toLocaleString("de")}
            </p>
          )}
          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text", textarea = false }) {
  const Component = textarea ? "textarea" : "input";
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <Component
        type={type}
        className={textarea ? "form-textarea" : "form-input"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
