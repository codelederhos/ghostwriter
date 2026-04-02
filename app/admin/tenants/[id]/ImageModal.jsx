"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, ChevronLeft, ChevronRight, Trash2, Sparkles, Plus, MapPin,
  ExternalLink, Link, Unlink, Check, ChevronDown, ChevronRight as ChevRight,
  Wand2, CheckCircle2, XCircle, Clock, GitBranch, Image as ImageIcon, Loader2,
} from "lucide-react";
import AddressAutocomplete from "./AddressAutocomplete";

const ROOM_TYPES = [
  "Wohnzimmer","Küche","Bad","Schlafzimmer","Kinderzimmer","Flur",
  "Keller","Dachgeschoss","Außenansicht","Garten","Büro","Garage",
  "Mehrfamilienhaus","Wohngebäude","Gewerbe","Grundstück","Sonstiges",
];

const CONDITIONS = [
  { key: "vorher",      label: "Vorher",    cls: "border-orange-300 bg-orange-50 text-orange-700",    dot: "bg-orange-400" },
  { key: "dazwischen",  label: "Umbau",     cls: "border-blue-300 bg-blue-50 text-blue-700",           dot: "bg-blue-400"   },
  { key: "nachher",     label: "Nachher",   cls: "border-teal-300 bg-teal-50 text-teal-700",           dot: "bg-teal-400"   },
  { key: "neutral",     label: "Neutral",   cls: "border-gray-300 bg-gray-50 text-gray-500",           dot: "bg-gray-400"   },
];

const APPROVAL_STYLES = {
  approved: { label: "Freigegeben", icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", gradient: "from-emerald-500 to-teal-400" },
  pending:  { label: "Ausstehend",  icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200",       gradient: "from-amber-400 to-orange-400" },
  rejected: { label: "Abgelehnt",   icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200",             gradient: "from-red-500 to-rose-400" },
};

export default function ImageModal({ images, initialIndex, onClose, onUpdate, onDelete, tenantId, properties: propsProp, onPropertyCreate }) {
  const [idx, setIdx] = useState(initialIndex);
  const [fadingOut, setFadingOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const [localProperties, setLocalProperties] = useState(propsProp || []);

  // Tabs im Slide-Over
  const [activeTab, setActiveTab] = useState("meta"); // meta | generate | tree

  useEffect(() => { setLocalProperties(propsProp || []); }, [propsProp]);

  // Editable fields
  const [desc, setDesc]           = useState("");
  const [tags, setTags]           = useState([]);
  const [roomType, setRoomType]   = useState("");
  const [condition, setCondition] = useState("neutral");
  const [propertyId, setPropertyId] = useState("");
  const [tagInput, setTagInput]   = useState("");

  // Inline property creation
  const [showNewProp, setShowNewProp]   = useState(false);
  const [newPropName, setNewPropName]   = useState("");
  const [newPropAddr, setNewPropAddr]   = useState("");
  const [newPropLat,  setNewPropLat]    = useState(null);
  const [newPropLng,  setNewPropLng]    = useState(null);
  const [newPropType, setNewPropType]   = useState("haus");
  const [newPropParent, setNewPropParent] = useState("");
  const [newPropSaving, setNewPropSaving] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // UI state
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [deleteStep, setDeleteStep]         = useState(0);
  const [deleteTimer, setDeleteTimer]       = useState(null);
  const [showSequencePicker, setShowSequencePicker] = useState(false);
  const [seqSelection, setSeqSelection]     = useState(new Set());
  const [linkLoading, setLinkLoading]       = useState(false);
  const [saveStatus, setSaveStatus]         = useState(null);

  // KI-Generierung
  const [genPrompt, setGenPrompt]       = useState("");
  const [genProvider, setGenProvider]    = useState("dalle3");
  const [genFormat, setGenFormat]        = useState("landscape");
  const [genLoading, setGenLoading]     = useState(false);
  const [genPreview, setGenPreview]     = useState(null); // { image_url, id }
  const [genError, setGenError]         = useState(null);

  const img = images[idx];
  const tagInputRef = useRef(null);

  // Sync local state when image changes
  useEffect(() => {
    if (!img) return;
    setDesc(img.description || "");
    setTags(Array.isArray(img.ai_tags) ? img.ai_tags : []);
    setRoomType(img.room_type || "");
    setCondition(img.condition_tag || "neutral");
    setPropertyId(img.property_id || "");
    setDeleteStep(0);
    setShowSequencePicker(false);
    setShowNewProp(false);
    setSeqSelection(new Set());
    setSaveStatus(null);
    setGenPreview(null);
    setGenError(null);
    if (deleteTimer) { clearTimeout(deleteTimer); setDeleteTimer(null); }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowLeft"  && !showSequencePicker && activeTab !== "generate") navigate("prev");
      if (e.key === "ArrowRight" && !showSequencePicker && activeTab !== "generate") navigate("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [idx, images.length, showSequencePicker, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    setClosing(true);
    setTimeout(() => onClose(), 250);
  }

  function navigate(dir) {
    const newIdx = dir === "next"
      ? Math.min(idx + 1, images.length - 1)
      : Math.max(idx - 1, 0);
    if (newIdx === idx) return;
    setFadingOut(true);
    setTimeout(() => { setIdx(newIdx); setTimeout(() => setFadingOut(false), 30); }, 150);
  }

  async function save(field, value) {
    setSaveStatus("saving");
    await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_image_meta", imageId: img.id, [field]: value }),
    });
    onUpdate(img.id, { [field]: value });
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(null), 1500);
  }

  async function addTag(raw) {
    const t = raw.trim().replace(/^[,\s]+|[,\s]+$/g, "");
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    await save("ai_tags", next);
  }

  async function removeTag(t) {
    const next = tags.filter(x => x !== t);
    setTags(next);
    await save("ai_tags", next);
  }

  async function setConditionAndSave(key) {
    setCondition(key);
    await save("condition_tag", key);
  }

  async function setRoomTypeAndSave(rt) {
    const next = rt === roomType ? "" : rt;
    setRoomType(next);
    await save("room_type", next);
  }

  async function setPropertyAndSave(pid) {
    setPropertyId(pid);
    await save("property_id", pid || null);
  }

  // ── Approval Actions ─────────────────────────────────────────

  async function approveImage() {
    await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", imageId: img.id }),
    });
    onUpdate(img.id, { approval_status: "approved", approved_at: new Date().toISOString() });
  }

  async function rejectImage() {
    await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", imageId: img.id }),
    });
    onUpdate(img.id, { approval_status: "rejected" });
  }

  async function setPending() {
    await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_pending", imageId: img.id }),
    });
    onUpdate(img.id, { approval_status: "pending" });
  }

  // ── KI-Generierung ───────────────────────────────────────────

  async function generateVariant() {
    if (!genPrompt.trim()) return;
    setGenLoading(true);
    setGenError(null);
    setGenPreview(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_variant",
          imageId: img.id,
          prompt: genPrompt,
          provider: genProvider,
          format: genFormat,
        }),
      });
      const data = await res.json();
      if (data.ok && data.image) {
        setGenPreview(data.image);
      } else {
        setGenError(data.error || "Generierung fehlgeschlagen");
      }
    } catch (e) {
      setGenError(e.message);
    }
    setGenLoading(false);
  }

  // ── Vision Analysis ──────────────────────────────────────────

  async function handleAnalyze() {
    setAnalyzeLoading(true);
    const res = await fetch(`/api/tenants/${tenantId}/images/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: img.id }),
    });
    const data = await res.json();
    if (data.ok && data.result) {
      const r = data.result;
      setDesc(r.description || desc);
      setTags(r.tags || []);
      setRoomType(r.room_type || "");
      setCondition(r.condition_tag || "neutral");
      onUpdate(img.id, {
        description: r.description,
        ai_tags: r.tags,
        room_type: r.room_type,
        condition_tag: r.condition_tag,
        ai_analyzed: true,
      });
    }
    setAnalyzeLoading(false);
  }

  // ── Delete ───────────────────────────────────────────────────

  function handleDeleteClick() {
    if (deleteStep === 0) {
      setDeleteStep(1);
      const t = setTimeout(() => setDeleteStep(0), 3000);
      setDeleteTimer(t);
    } else {
      if (deleteTimer) clearTimeout(deleteTimer);
      const imgId = img.id;
      const newIdx = Math.min(idx, images.length - 2);
      if (images.length <= 1) { onDelete(imgId); onClose(); return; }
      setFadingOut(true);
      setTimeout(() => {
        onDelete(imgId);
        setIdx(newIdx);
        setTimeout(() => setFadingOut(false), 30);
      }, 150);
    }
  }

  // ── Sequence Link ────────────────────────────────────────────

  async function linkImages() {
    if (seqSelection.size === 0) { setShowSequencePicker(false); return; }
    setLinkLoading(true);
    const allIds = [img.id, ...Array.from(seqSelection)];
    const existingGroup = img.sequence_group;
    const res = await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link_images", imageIds: allIds, groupId: existingGroup }),
    });
    const data = await res.json();
    if (data.ok) {
      allIds.forEach(iid => onUpdate(iid, { sequence_group: data.group }));
    }
    setLinkLoading(false);
    setShowSequencePicker(false);
    setSeqSelection(new Set());
  }

  async function unlinkFromSequence() {
    await fetch(`/api/tenants/${tenantId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink_image", imageId: img.id }),
    });
    onUpdate(img.id, { sequence_group: null });
  }

  // ── Property Create ──────────────────────────────────────────

  async function createProperty() {
    if (!newPropName.trim()) return;
    setNewPropSaving(true);
    const res = await fetch(`/api/tenants/${tenantId}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: newPropName.trim(),
        address: newPropAddr.trim() || null,
        lat: newPropLat, lng: newPropLng,
        type: newPropType,
        parent_id: newPropParent || null,
      }),
    });
    const data = await res.json();
    if (data.ok && data.property) {
      const p = { ...data.property, image_count: 0 };
      setLocalProperties(prev => [...prev, p]);
      onPropertyCreate?.(p);
      setPropertyId(p.id);
      await save("property_id", p.id);
      setNewPropName(""); setNewPropAddr(""); setNewPropLat(null); setNewPropLng(null);
      setNewPropType("haus"); setNewPropParent(""); setShowNewProp(false);
    }
    setNewPropSaving(false);
  }

  function toggleExpand(id) {
    setExpandedNodes(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  if (!img) return null;

  const linkedImages = img.sequence_group
    ? images.filter(i => i.sequence_group === img.sequence_group && i.id !== img.id)
    : [];
  const currentProp = localProperties.find(p => p.id === propertyId);
  const condObj = CONDITIONS.find(c => c.key === condition) || CONDITIONS[3];
  const approvalInfo = APPROVAL_STYLES[img.approval_status] || APPROVAL_STYLES.pending;
  const ApprovalIcon = approvalInfo.icon;

  // Stammbaum: alle Bilder mit gleichem parent oder die parent dieses Bildes sind
  const parentImg = img.parent_image_id ? images.find(i => i.id === img.parent_image_id) : null;
  const childImages = images.filter(i => i.parent_image_id === img.id);
  // Finde Root des Stammbaums
  const findRoot = (imgItem) => {
    if (!imgItem?.parent_image_id) return imgItem;
    const parent = images.find(i => i.id === imgItem.parent_image_id);
    return parent ? findRoot(parent) : imgItem;
  };
  const treeRoot = findRoot(img);
  const getChildren = (parentId) => images.filter(i => i.parent_image_id === parentId);

  const TABS = [
    { key: "meta", label: "Details" },
    { key: "generate", label: "KI-Variante", icon: Wand2 },
    { key: "tree", label: "Stammbaum", icon: GitBranch, count: childImages.length + (parentImg ? 1 : 0) },
  ];

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex justify-end"
      style={{
        backgroundColor: closing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.35)",
        backdropFilter: closing ? "none" : "blur(4px)",
        transition: "background-color 250ms, backdrop-filter 250ms",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="relative bg-card h-full shadow-2xl overflow-hidden flex flex-col border-l border-border"
        style={{
          width: "min(520px, 95vw)",
          animation: closing
            ? "slideOutRight 250ms cubic-bezier(0.16,1,0.3,1) both"
            : "slideInRight 300ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {idx + 1} <span className="opacity-40">/</span> {images.length}
            </span>
            {saveStatus === "saving" && <span className="text-xs text-muted-foreground animate-pulse">Speichert…</span>}
            {saveStatus === "saved"  && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check size={11} /> Gespeichert</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate("prev")} disabled={idx === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors" title="← Vorheriges">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => navigate("next")} disabled={idx === images.length - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors" title="Nächstes →">
              <ChevronRight size={18} />
            </button>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors ml-1" title="Schließen (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Image Preview ──────────────────────────────────────── */}
        <div className="relative bg-neutral-950 flex items-center justify-center overflow-hidden shrink-0" style={{ height: "240px" }}>
          <img
            src={img.image_url}
            alt={img.description || "Referenzbild"}
            className="max-w-full max-h-full object-contain"
            style={{ opacity: fadingOut ? 0 : 1, transition: "opacity 150ms ease" }}
          />

          {/* KI-Badge */}
          {img.is_ai_generated && (
            <span
              className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold text-white flex items-center gap-1"
              style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}
            >
              <Wand2 size={10} /> KI-generiert
            </span>
          )}

          {/* Approval-Badge */}
          <span
            className={`absolute top-3 left-3 px-2 py-1 rounded-full text-[10px] font-bold text-white flex items-center gap-1`}
            style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}
          >
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white flex items-center gap-1"
              style={{
                background: img.approval_status === "approved"
                  ? "linear-gradient(135deg, #10b981, #34d399)"
                  : img.approval_status === "rejected"
                  ? "linear-gradient(135deg, #ef4444, #f87171)"
                  : "linear-gradient(135deg, #f59e0b, #fbbf24)",
              }}
            >
              <ApprovalIcon size={10} />
              {approvalInfo.label}
            </span>
          </span>

          {/* Side nav zones */}
          {idx > 0 && (
            <button onClick={() => navigate("prev")} className="absolute left-0 inset-y-0 w-12 flex items-center justify-start pl-2 group">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-2">
                <ChevronLeft size={18} className="text-white" />
              </div>
            </button>
          )}
          {idx < images.length - 1 && (
            <button onClick={() => navigate("next")} className="absolute right-0 inset-y-0 w-12 flex items-center justify-end pr-2 group">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-2">
                <ChevronRight size={18} className="text-white" />
              </div>
            </button>
          )}

          {/* Open full */}
          <a href={img.image_url} target="_blank" rel="noopener noreferrer"
            className="absolute bottom-3 right-3 opacity-0 hover:opacity-100 bg-black/50 backdrop-blur-sm rounded-lg p-1.5 transition-opacity"
            title="Originalgröße öffnen">
            <ExternalLink size={13} className="text-white" />
          </a>
        </div>

        {/* ── Approval Action Bar ────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
          {img.approval_status !== "approved" && (
            <button onClick={approveImage}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg font-medium transition-all bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
              <CheckCircle2 size={13} /> Freigeben
            </button>
          )}
          {img.approval_status !== "rejected" && (
            <button onClick={rejectImage}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg font-medium transition-all bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">
              <XCircle size={13} /> Ablehnen
            </button>
          )}
          {img.approval_status !== "pending" && (
            <button onClick={setPending}
              className="flex items-center justify-center gap-1.5 text-xs py-1.5 px-3 rounded-lg font-medium transition-all bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
              <Clock size={13} /> Zurücksetzen
            </button>
          )}
        </div>

        {/* ── Tab Bar ────────────────────────────────────────────── */}
        <div className="flex border-b border-border shrink-0">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all border-b-2 ${
                  active
                    ? "border-indigo-500 text-indigo-700 bg-indigo-50/30"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                {Icon && <Icon size={13} />}
                {t.label}
                {t.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full leading-none ${active ? "bg-indigo-100 text-indigo-700" : "bg-muted text-muted-foreground"}`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab Content ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ════ META TAB ═══════════════════════════════════════════ */}
          {activeTab === "meta" && (
            <div className="p-4 space-y-5">
              {/* Raumtyp */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Raumtyp</p>
                <div className="flex flex-wrap gap-1" style={{ animation: "fadeSlideUp 200ms ease both" }}>
                  {ROOM_TYPES.map(rt => (
                    <button key={rt} onClick={() => setRoomTypeAndSave(rt)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                        roomType === rt
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "border-border text-muted-foreground hover:border-indigo-300 hover:text-indigo-600"
                      }`}>{rt}</button>
                  ))}
                </div>
              </section>

              {/* Zustand */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Zustand</p>
                <div className="grid grid-cols-4 gap-1">
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setConditionAndSave(c.key)}
                      className={`text-[11px] py-1.5 rounded-lg border-2 font-medium transition-all ${
                        condition === c.key ? c.cls + " border-2" : "border-border text-muted-foreground hover:border-muted-foreground/40"
                      }`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${condition === c.key ? c.dot : "bg-muted-foreground/30"}`} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Beschreibung */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Beschreibung</p>
                <textarea
                  className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 transition-all"
                  rows={4}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onBlur={() => { if (desc !== (img.description || "")) save("description", desc); }}
                  placeholder="Was zeigt dieses Bild?"
                />
              </section>

              {/* Tags */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 group">
                      {t}
                      <button onClick={() => removeTag(t)} className="opacity-60 group-hover:opacity-100 hover:text-red-600 transition-colors"><X size={10} /></button>
                    </span>
                  ))}
                  {tags.length === 0 && <span className="text-xs text-muted-foreground/50">Noch keine Tags</span>}
                </div>
                <div className="flex gap-1.5">
                  <input ref={tagInputRef}
                    className="flex-1 text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 transition-all bg-muted/20"
                    placeholder="Tag hinzufügen…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
                  />
                  <button onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}
                    className="px-2 rounded-lg border border-border hover:bg-muted disabled:opacity-30 transition-colors">
                    <Plus size={13} />
                  </button>
                </div>
              </section>

              {/* Objekt / Standort */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Objekt / Standort</p>
                  <button onClick={() => setShowNewProp(v => !v)}
                    className="flex items-center gap-0.5 text-[11px] text-emerald-600 hover:text-emerald-800 font-medium transition-colors">
                    <Plus size={13} /> Neu
                  </button>
                </div>

                {showNewProp && (
                  <div className="mb-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
                    <input autoFocus
                      className="w-full text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 bg-white transition-all"
                      placeholder="Name (z.B. Schillerstr. 12)"
                      value={newPropName}
                      onChange={(e) => setNewPropName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") createProperty(); if (e.key === "Escape") setShowNewProp(false); }}
                    />
                    <AddressAutocomplete value={newPropAddr}
                      onChange={(addr, lat, lng) => { setNewPropAddr(addr); if (lat) { setNewPropLat(lat); setNewPropLng(lng); } }}
                      placeholder="Adresse suchen (OpenStreetMap)…"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select className="text-xs rounded-lg border border-border px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                        value={newPropType} onChange={(e) => setNewPropType(e.target.value)}>
                        {[["ort","Ort/Standort"],["haus","Haus"],["mfh","Mehrfam.haus"],["wohnung","Wohnung"],["zimmer","Zimmer/Bereich"],["gewerbe","Gewerbe"],["grundstueck","Grundstück"],["sonstiges","Sonstiges"]].map(([k,l]) => (
                          <option key={k} value={k}>{l}</option>
                        ))}
                      </select>
                      <select className="text-xs rounded-lg border border-border px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                        value={newPropParent} onChange={(e) => setNewPropParent(e.target.value)}>
                        <option value="">Kein übergeord. Objekt</option>
                        {localProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={createProperty} disabled={!newPropName.trim() || newPropSaving}
                        className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                        {newPropSaving ? "…" : "Anlegen + auswählen"}
                      </button>
                      <button onClick={() => setShowNewProp(false)} className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Baum */}
                {(() => {
                  const ICONS = { ort:"📍", haus:"🏢", mfh:"🏠", wohnung:"🚪", zimmer:"🛋️", gewerbe:"🏪", grundstueck:"🌳", sonstiges:"📦" };
                  function TreeNode({ node, depth }) {
                    const children = localProperties.filter(p => p.parent_id === node.id);
                    const hasChildren = children.length > 0;
                    const isExpanded = expandedNodes.has(node.id);
                    const isSelected = propertyId === node.id;
                    return (
                      <div>
                        <div style={{ paddingLeft: depth * 12 }}
                          className={`flex items-center gap-1 py-1.5 px-2 rounded-lg cursor-pointer transition-all text-xs ${
                            isSelected ? "bg-indigo-600 text-white font-medium" : "hover:bg-muted/60 text-foreground"
                          }`}
                          onClick={() => setPropertyAndSave(isSelected ? "" : node.id)}>
                          {hasChildren ? (
                            <button onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                              className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${isSelected ? "text-white/80" : "text-muted-foreground/60"}`}>
                              {isExpanded ? <ChevronDown size={10} /> : <ChevRight size={10} />}
                            </button>
                          ) : <span className="w-4" />}
                          <span className="text-[10px]">{ICONS[node.type] || "📦"}</span>
                          <span className="truncate flex-1">{node.name}</span>
                        </div>
                        {hasChildren && isExpanded && children.map(child => <TreeNode key={child.id} node={child} depth={depth + 1} />)}
                      </div>
                    );
                  }
                  const roots = localProperties.filter(p => !p.parent_id);
                  return (
                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-all text-xs border-b border-border/50 ${
                        !propertyId ? "bg-indigo-600 text-white font-medium" : "hover:bg-muted/40 text-muted-foreground"
                      }`} onClick={() => setPropertyAndSave("")}>
                        <span className="text-[10px]">—</span><span>Kein Objekt</span>
                      </div>
                      {roots.length === 0 && !showNewProp && (
                        <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">Noch keine Objekte.</div>
                      )}
                      <div className="p-1 space-y-0.5">
                        {roots.map(node => <TreeNode key={node.id} node={node} depth={0} />)}
                      </div>
                    </div>
                  );
                })()}

                {currentProp?.lat && currentProp?.lng && (
                  <div className="mt-2 space-y-1">
                    <iframe loading="lazy"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${currentProp.lng - 0.005},${currentProp.lat - 0.005},${currentProp.lng + 0.005},${currentProp.lat + 0.005}&layer=mapnik&marker=${currentProp.lat},${currentProp.lng}`}
                      style={{ border: "none", borderRadius: "10px", width: "100%", height: "130px", display: "block" }}
                      title="Standort"
                    />
                    <a href={`https://maps.google.com/?q=${currentProp.lat},${currentProp.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors">
                      <MapPin size={11} /> In Google Maps öffnen
                    </a>
                  </div>
                )}
              </section>

              {/* Sequenz */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sequenz (Vorher–Nachher)</p>
                {linkedImages.length > 0 && (
                  <div className="mb-2">
                    <div className="flex gap-1.5 flex-wrap">
                      {linkedImages.map(li => {
                        const liCond = CONDITIONS.find(c => c.key === li.condition_tag);
                        return (
                          <button key={li.id}
                            onClick={() => { const liIdx = images.findIndex(i => i.id === li.id); if (liIdx >= 0) { setFadingOut(true); setTimeout(() => { setIdx(liIdx); setTimeout(() => setFadingOut(false), 30); }, 150); } }}
                            className="relative group" title={`${li.condition_tag} — klicken zum Öffnen`}>
                            <img src={li.thumb_url || li.image_url} className="w-14 h-14 object-cover rounded-lg border-2 border-border group-hover:border-indigo-400 transition-colors" alt="" />
                            {liCond && (
                              <span className={`absolute bottom-0.5 left-0.5 right-0.5 text-[9px] text-center font-medium rounded-b-md py-0.5 ${liCond.cls}`}>
                                {liCond.label}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={unlinkFromSequence} className="mt-1.5 flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 transition-colors">
                      <Unlink size={11} /> Aus Sequenz entfernen
                    </button>
                  </div>
                )}
                {!showSequencePicker ? (
                  <button onClick={() => setShowSequencePicker(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-indigo-600 transition-colors">
                    <Link size={13} />
                    {linkedImages.length > 0 ? "Weitere verknüpfen" : "Mit anderem Bild verknüpfen"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">Bilder auswählen zum Verknüpfen:</p>
                    <div className="grid grid-cols-5 gap-1 max-h-40 overflow-y-auto pr-1">
                      {images.filter(i => i.id !== img.id).map(i => {
                        const sel = seqSelection.has(i.id);
                        return (
                          <button key={i.id}
                            onClick={() => { const s = new Set(seqSelection); sel ? s.delete(i.id) : s.add(i.id); setSeqSelection(s); }}
                            className={`relative rounded-lg overflow-hidden border-2 transition-all ${sel ? "border-indigo-500 ring-1 ring-indigo-400" : "border-transparent hover:border-indigo-300"}`}>
                            <img src={i.thumb_url || i.image_url} className="w-full aspect-square object-cover" alt="" />
                            {sel && <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center"><Check size={14} className="text-indigo-700" /></div>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={linkImages} disabled={seqSelection.size === 0 || linkLoading}
                        className="flex-1 text-xs py-1.5 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50 transition-opacity">
                        {linkLoading ? "Verknüpfe…" : `${seqSelection.size} verknüpfen`}
                      </button>
                      <button onClick={() => { setShowSequencePicker(false); setSeqSelection(new Set()); }}
                        className="px-3 text-xs py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ════ GENERATE TAB ═══════════════════════════════════════ */}
          {activeTab === "generate" && (
            <div className="p-4 space-y-4">
              {/* Reference */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Referenzbild</p>
                <div className="flex gap-3">
                  <div className="w-28 h-20 rounded-lg overflow-hidden border border-border shrink-0">
                    <img src={img.thumb_url || img.image_url} className="w-full h-full object-cover" alt="Referenz" />
                  </div>
                  {genPreview ? (
                    <div className="w-28 h-20 rounded-lg overflow-hidden border-2 border-violet-400 shrink-0"
                      style={{ animation: "cardFadeUp 400ms cubic-bezier(0.16,1,0.3,1) both" }}>
                      <img src={genPreview.image_url} className="w-full h-full object-cover" alt="Generiert" />
                    </div>
                  ) : genLoading ? (
                    <div className="w-28 h-20 rounded-lg border border-border shrink-0 overflow-hidden"
                      style={{ background: "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)", backgroundSize: "200% 100%", animation: "shimmerGlow 1.5s infinite" }}
                    />
                  ) : (
                    <div className="w-28 h-20 rounded-lg border-2 border-dashed border-border shrink-0 flex items-center justify-center">
                      <Wand2 size={16} className="text-muted-foreground/30" />
                    </div>
                  )}
                </div>
              </section>

              {/* Prompt */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Prompt</p>
                <textarea
                  className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-all"
                  rows={4}
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder="z.B. Modernisiertes Wohnzimmer mit hellem Parkett und großen Fenstern…"
                />
              </section>

              {/* Provider + Format */}
              <div className="grid grid-cols-2 gap-3">
                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Provider</p>
                  <select className="w-full text-xs rounded-lg border border-border px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                    value={genProvider} onChange={(e) => setGenProvider(e.target.value)}>
                    <option value="dalle3">GPT-Image-1</option>
                    <option value="flux">Flux (fal.ai)</option>
                    <option value="stock">Stock (Unsplash)</option>
                  </select>
                </section>
                <section>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Format</p>
                  <select className="w-full text-xs rounded-lg border border-border px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                    value={genFormat} onChange={(e) => setGenFormat(e.target.value)}>
                    <option value="landscape">Landscape (16:9)</option>
                    <option value="portrait">Portrait (9:16)</option>
                    <option value="square">Quadrat (1:1)</option>
                  </select>
                </section>
              </div>

              {/* Error */}
              {genError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {genError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {!genPreview ? (
                  <button onClick={generateVariant} disabled={!genPrompt.trim() || genLoading}
                    className="btn-ai flex-1 py-2.5 text-sm rounded-lg disabled:opacity-50">
                    {genLoading ? (
                      <><Loader2 size={14} className="animate-spin" /> Generiert…</>
                    ) : (
                      <><Wand2 size={14} /> Generieren</>
                    )}
                  </button>
                ) : (
                  <>
                    <button onClick={() => { setGenPreview(null); setGenPrompt(""); setActiveTab("meta"); }}
                      className="flex-1 py-2 text-xs rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5">
                      <Check size={13} /> Fertig
                    </button>
                    <button onClick={() => { setGenPreview(null); }}
                      className="flex-1 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5">
                      <Wand2 size={13} /> Nochmal
                    </button>
                  </>
                )}
              </div>

              {/* Info */}
              {genPreview && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2"
                  style={{ animation: "cardFadeUp 300ms ease both" }}>
                  <CheckCircle2 size={14} />
                  <div>
                    <p className="font-medium">KI-Variante erstellt</p>
                    <p className="text-emerald-600">Status: Ausstehend — muss noch freigegeben werden.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════ TREE TAB ═══════════════════════════════════════════ */}
          {activeTab === "tree" && (
            <div className="p-4 space-y-4">
              {!parentImg && childImages.length === 0 ? (
                <div className="text-center py-8">
                  <GitBranch size={28} className="mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Keine verknüpften KI-Varianten</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Erstelle eine im "KI-Variante"-Tab</p>
                </div>
              ) : (
                <>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Bild-Stammbaum</p>
                  {/* Recursive tree rendering */}
                  {(() => {
                    function TreeImageNode({ node, depth, isActive }) {
                      const nodeChildren = getChildren(node.id);
                      const nodeApproval = APPROVAL_STYLES[node.approval_status] || APPROVAL_STYLES.pending;
                      const NodeIcon = nodeApproval.icon;
                      return (
                        <div>
                          <div
                            style={{ marginLeft: depth * 20 }}
                            className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-all ${
                              isActive
                                ? "bg-indigo-50 border border-indigo-300 ring-1 ring-indigo-200"
                                : "hover:bg-muted/40 border border-transparent"
                            }`}
                            onClick={() => {
                              const targetIdx = images.findIndex(i => i.id === node.id);
                              if (targetIdx >= 0 && targetIdx !== idx) {
                                setFadingOut(true);
                                setTimeout(() => { setIdx(targetIdx); setTimeout(() => setFadingOut(false), 30); }, 150);
                              }
                            }}
                          >
                            {/* Connector line */}
                            {depth > 0 && (
                              <div className="flex items-center gap-1 shrink-0">
                                <div className="w-3 border-t border-muted-foreground/20" />
                                {node.is_ai_generated && (
                                  <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                                    style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
                                    <Wand2 size={8} className="text-white" />
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Thumb */}
                            <img src={node.thumb_url || node.image_url} className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border" alt="" />

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                {!node.is_ai_generated && <span className="text-[9px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ORIGINAL</span>}
                                {node.is_ai_generated && <span className="text-[9px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">KI</span>}
                                <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border ${nodeApproval.cls}`}>
                                  <NodeIcon size={8} />
                                  {nodeApproval.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {node.generation_prompt ? node.generation_prompt.slice(0, 60) + "…" : node.description?.slice(0, 60) || "Kein Text"}
                              </p>
                            </div>
                          </div>
                          {nodeChildren.map(child => (
                            <TreeImageNode key={child.id} node={child} depth={depth + 1} isActive={child.id === img.id} />
                          ))}
                        </div>
                      );
                    }

                    return <TreeImageNode node={treeRoot} depth={0} isActive={treeRoot.id === img.id} />;
                  })()}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Footer Actions ─────────────────────────────────────── */}
        <div className="border-t border-border p-3 flex gap-2 shrink-0 bg-muted/20">
          <button onClick={handleAnalyze} disabled={analyzeLoading}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-60 transition-all font-medium">
            {analyzeLoading
              ? <><span className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" /> Analysiert…</>
              : <><Sparkles size={14} /> KI-Analyse</>
            }
          </button>
          <button onClick={handleDeleteClick}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border font-medium transition-all ${
              deleteStep === 1
                ? "bg-red-500 text-white border-red-500 animate-pulse"
                : "border-border text-muted-foreground hover:border-red-300 hover:text-red-600 hover:bg-red-50"
            }`} title="Bild löschen">
            <Trash2 size={14} />
            {deleteStep === 1 ? "Sicher?" : ""}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
