"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Trash2, Sparkles, Plus, MapPin, ExternalLink, Link, Unlink, Check } from "lucide-react";

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

const PROP_TYPES = [
  { key: "haus",        label: "Haus"        },
  { key: "wohnung",     label: "Wohnung"     },
  { key: "gewerbe",     label: "Gewerbe"     },
  { key: "grundstueck", label: "Grundstück"  },
  { key: "sonstiges",   label: "Sonstiges"   },
];

export default function ImageModal({ images, initialIndex, onClose, onUpdate, onDelete, tenantId, properties }) {
  const [idx, setIdx] = useState(initialIndex);
  const [fadingOut, setFadingOut] = useState(false);

  // Editable fields (local mirror of current image)
  const [desc, setDesc]           = useState("");
  const [tags, setTags]           = useState([]);
  const [roomType, setRoomType]   = useState("");
  const [condition, setCondition] = useState("neutral");
  const [propertyId, setPropertyId] = useState("");
  const [tagInput, setTagInput]   = useState("");

  // UI state
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [deleteStep, setDeleteStep]         = useState(0); // 0=normal, 1=confirm
  const [deleteTimer, setDeleteTimer]       = useState(null);
  const [showSequencePicker, setShowSequencePicker] = useState(false);
  const [seqSelection, setSeqSelection]     = useState(new Set());
  const [linkLoading, setLinkLoading]       = useState(false);
  const [saveStatus, setSaveStatus]         = useState(null); // null | "saving" | "saved"

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
    setSeqSelection(new Set());
    setSaveStatus(null);
    if (deleteTimer) { clearTimeout(deleteTimer); setDeleteTimer(null); }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft"  && !showSequencePicker) navigate("prev");
      if (e.key === "ArrowRight" && !showSequencePicker) navigate("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [idx, images.length, showSequencePicker]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!img) return null;

  const linkedImages = img.sequence_group
    ? images.filter(i => i.sequence_group === img.sequence_group && i.id !== img.id)
    : [];
  const currentProp = properties.find(p => p.id === propertyId);
  const condObj = CONDITIONS.find(c => c.key === condition) || CONDITIONS[3];

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-card w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          maxWidth: "1024px",
          maxHeight: "92vh",
          animation: "modalIn 180ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <style>{`
          @keyframes modalIn {
            from { opacity:0; transform:scale(0.96) translateY(8px); }
            to   { opacity:1; transform:scale(1) translateY(0); }
          }
          @keyframes fadeSlideUp {
            from { opacity:0; transform:translateY(6px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/90 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {idx + 1} <span className="opacity-40">/</span> {images.length}
            </span>
            {saveStatus === "saving" && <span className="text-xs text-muted-foreground animate-pulse">Speichert…</span>}
            {saveStatus === "saved"  && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check size={11} /> Gespeichert</span>}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("prev")}
              disabled={idx === 0}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
              title="Vorheriges Bild (←)"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => navigate("next")}
              disabled={idx === images.length - 1}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
              title="Nächstes Bild (→)"
            >
              <ChevronRight size={18} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors ml-1" title="Schließen (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: Image */}
          <div className="relative flex-1 bg-neutral-950 flex items-center justify-center overflow-hidden min-h-[300px]">
            <img
              src={img.image_url}
              alt={img.description || "Referenzbild"}
              className="max-w-full max-h-full object-contain"
              style={{
                opacity: fadingOut ? 0 : 1,
                transition: "opacity 150ms ease",
              }}
            />
            {/* Side nav zones */}
            {idx > 0 && (
              <button
                onClick={() => navigate("prev")}
                className="absolute left-0 inset-y-0 w-14 flex items-center justify-start pl-2 group"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-2">
                  <ChevronLeft size={20} className="text-white" />
                </div>
              </button>
            )}
            {idx < images.length - 1 && (
              <button
                onClick={() => navigate("next")}
                className="absolute right-0 inset-y-0 w-14 flex items-center justify-end pr-2 group"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-2">
                  <ChevronRight size={20} className="text-white" />
                </div>
              </button>
            )}
            {/* Bild öffnen */}
            <a
              href={img.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 right-3 opacity-0 hover:opacity-100 bg-black/50 backdrop-blur-sm rounded-lg p-1.5 transition-opacity"
              title="Originalgröße öffnen"
            >
              <ExternalLink size={13} className="text-white" />
            </a>
          </div>

          {/* Right: Edit Panel */}
          <div className="w-[340px] shrink-0 border-l border-border overflow-y-auto flex flex-col">
            <div className="p-4 space-y-5 flex-1">

              {/* Raumtyp */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Raumtyp</p>
                <div
                  className="flex flex-wrap gap-1"
                  style={{ animation: "fadeSlideUp 200ms ease both" }}
                >
                  {ROOM_TYPES.map(rt => (
                    <button
                      key={rt}
                      onClick={() => setRoomTypeAndSave(rt)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                        roomType === rt
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "border-border text-muted-foreground hover:border-indigo-300 hover:text-indigo-600"
                      }`}
                    >{rt}</button>
                  ))}
                </div>
              </section>

              {/* Zustand */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Zustand</p>
                <div className="grid grid-cols-4 gap-1">
                  {CONDITIONS.map(c => (
                    <button
                      key={c.key}
                      onClick={() => setConditionAndSave(c.key)}
                      className={`text-[11px] py-1.5 rounded-lg border-2 font-medium transition-all ${
                        condition === c.key ? c.cls + " border-2" : "border-border text-muted-foreground hover:border-muted-foreground/40"
                      }`}
                    >
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
                  className="w-full text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 transition-all"
                  rows={3}
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
                      <button onClick={() => removeTag(t)} className="opacity-60 group-hover:opacity-100 hover:text-red-600 transition-colors">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {tags.length === 0 && <span className="text-xs text-muted-foreground/50">Noch keine Tags</span>}
                </div>
                <div className="flex gap-1.5">
                  <input
                    ref={tagInputRef}
                    className="flex-1 text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 transition-all bg-muted/20"
                    placeholder="Tag hinzufügen…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
                  />
                  <button
                    onClick={() => addTag(tagInput)}
                    disabled={!tagInput.trim()}
                    className="px-2 rounded-lg border border-border hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </section>

              {/* Objekt / Standort */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Objekt / Standort</p>
                {properties.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">Noch keine Objekte angelegt — im Bilder-Tab erstellen.</p>
                ) : (
                  <div className="space-y-1">
                    <button
                      onClick={() => setPropertyAndSave("")}
                      className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                        !propertyId ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/40"
                      }`}
                    >
                      Kein Objekt
                    </button>
                    {properties.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setPropertyAndSave(p.id)}
                        className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                          propertyId === p.id
                            ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-medium"
                            : "border-border text-muted-foreground hover:border-muted-foreground/40"
                        }`}
                      >
                        <span className="truncate">{p.name}</span>
                        {p.address && (
                          <span className="shrink-0 flex items-center gap-0.5 text-[10px] opacity-60">
                            <MapPin size={9} />{p.address.split(",")[0]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {currentProp?.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(currentProp.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    <MapPin size={11} /> In Google Maps öffnen
                  </a>
                )}
              </section>

              {/* Sequenz / Verknüpfung */}
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sequenz (Vorher–Nachher)</p>
                {linkedImages.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[10px] text-muted-foreground mb-1.5">Verknüpfte Bilder:</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {linkedImages.map(li => {
                        const liCond = CONDITIONS.find(c => c.key === li.condition_tag);
                        return (
                          <button
                            key={li.id}
                            onClick={() => { const liIdx = images.findIndex(i => i.id === li.id); if (liIdx >= 0) { setFadingOut(true); setTimeout(() => { setIdx(liIdx); setTimeout(() => setFadingOut(false), 30); }, 150); } }}
                            className="relative group"
                            title={`${li.condition_tag} — klicken zum Öffnen`}
                          >
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
                  <button
                    onClick={() => setShowSequencePicker(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-indigo-600 transition-colors"
                  >
                    <Link size={13} />
                    {linkedImages.length > 0 ? "Weitere verknüpfen" : "Mit anderem Bild verknüpfen"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">Bilder auswählen zum Verknüpfen:</p>
                    <div className="grid grid-cols-5 gap-1 max-h-40 overflow-y-auto pr-1">
                      {images
                        .filter(i => i.id !== img.id)
                        .map(i => {
                          const sel = seqSelection.has(i.id);
                          return (
                            <button
                              key={i.id}
                              onClick={() => {
                                const s = new Set(seqSelection);
                                sel ? s.delete(i.id) : s.add(i.id);
                                setSeqSelection(s);
                              }}
                              className={`relative rounded-lg overflow-hidden border-2 transition-all ${sel ? "border-indigo-500 ring-1 ring-indigo-400" : "border-transparent hover:border-indigo-300"}`}
                            >
                              <img src={i.thumb_url || i.image_url} className="w-full aspect-square object-cover" alt="" />
                              {sel && <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center"><Check size={14} className="text-indigo-700" /></div>}
                            </button>
                          );
                        })}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={linkImages}
                        disabled={seqSelection.size === 0 || linkLoading}
                        className="flex-1 text-xs py-1.5 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50 transition-opacity"
                      >
                        {linkLoading ? "Verknüpfe…" : `${seqSelection.size} Bild${seqSelection.size !== 1 ? "er" : ""} verknüpfen`}
                      </button>
                      <button onClick={() => { setShowSequencePicker(false); setSeqSelection(new Set()); }} className="px-3 text-xs py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-border p-4 flex gap-2 shrink-0 bg-muted/20">
              <button
                onClick={handleAnalyze}
                disabled={analyzeLoading}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-60 transition-all font-medium"
              >
                {analyzeLoading
                  ? <><span className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" /> Analysiert…</>
                  : <><Sparkles size={14} /> KI-Analyse</>
                }
              </button>
              <button
                onClick={handleDeleteClick}
                className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border font-medium transition-all ${
                  deleteStep === 1
                    ? "bg-red-500 text-white border-red-500 animate-pulse"
                    : "border-border text-muted-foreground hover:border-red-300 hover:text-red-600 hover:bg-red-50"
                }`}
                title="Bild löschen"
              >
                <Trash2 size={14} />
                {deleteStep === 1 ? "Sicher?" : ""}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
