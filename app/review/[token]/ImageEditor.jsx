"use client";

import { useState } from "react";

/**
 * Bild-Editor im Bleistift-Modus (Stani 14.07.2026):
 * Pro Bild selbst entscheiden — neu generieren (einfacher Szenen-Prompt,
 * Stil kommt automatisch), Referenzbild aus dem Media Hub wählen oder hochladen.
 */
export default function ImageEditor({ token, images }) {
  const [openSlot, setOpenSlot] = useState(null); // "1" | "2" | null
  const [mode, setMode] = useState(null); // "generate" | "reference" | "upload"
  const [scene, setScene] = useState("");
  const [refs, setRefs] = useState(null);
  const [selectedRef, setSelectedRef] = useState(null); // optionale Vorlage im Generieren-Modus
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const slots = [
    { key: "1", label: "Titelbild", url: images?.url1 },
    { key: "2", label: "Artikelbild", url: images?.url2 },
  ].filter((s) => s.url || s.key === "1");

  function openEditor(slotKey, nextMode) {
    setOpenSlot(slotKey);
    setMode(nextMode);
    setError(null);
    setDone(false);
    setScene("");
    setSelectedRef(null);
    if ((nextMode === "reference" || nextMode === "generate") && refs === null) {
      fetch(`/api/review/image-update?token=${encodeURIComponent(token)}`)
        .then((r) => r.json())
        .then((d) => setRefs(d.references || []))
        .catch(() => setRefs([]));
    }
  }

  async function submit(payload, isForm = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/review/image-update?token=${encodeURIComponent(token)}`, {
        method: "POST",
        ...(isForm
          ? { body: payload }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Fehlgeschlagen. Bitte erneut versuchen.");
        return;
      }
      setDone(true);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gw-imgedit">
      <p className="gw-imgedit__title">Bilder</p>
      <div className="gw-imgedit__slots">
        {slots.map((slot) => (
          <div key={slot.key} className="gw-imgedit__slot">
            {slot.url
              ? <img src={slot.url} alt={slot.label} className="gw-imgedit__thumb" />
              : <div className="gw-imgedit__thumb gw-imgedit__thumb--empty">kein Bild</div>}
            <p className="gw-imgedit__label">{slot.label}</p>
            <div className="gw-imgedit__buttons">
              <button type="button" className="btn btn-outline text-xs px-2 py-1" onClick={() => openEditor(slot.key, "generate")}>Neu generieren</button>
              <button type="button" className="btn btn-outline text-xs px-2 py-1" onClick={() => openEditor(slot.key, "reference")}>Referenz wählen</button>
              <label className="btn btn-outline text-xs px-2 py-1" style={{ cursor: "pointer" }}>
                Hochladen
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setOpenSlot(slot.key);
                    setMode("upload");
                    const form = new FormData();
                    form.set("token", token);
                    form.set("which", slot.key);
                    form.set("file", file);
                    submit(form, true);
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {openSlot && mode === "generate" && (
        <form
          className="gw-imgedit__panel"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ token, which: openSlot, mode: "generate", prompt: scene, referenceId: selectedRef || undefined });
          }}
        >
          <textarea
            className="form-textarea text-sm"
            rows={3}
            maxLength={500}
            value={scene}
            autoFocus
            disabled={busy || done}
            onChange={(e) => setScene(e.target.value)}
            placeholder="Beschreibe einfach die Szene, z.B.: Fotografin richtet im hellen Studio das Licht für ein Familienshooting ein. Der Bild-Stil (hell, edel, modern) kommt automatisch dazu."
          />
          {Array.isArray(refs) && refs.length > 0 && (
            <div className="gw-imgedit__refpick">
              <p className="gw-imgedit__refpickLabel">
                Vorlage (optional): echtes Foto anklicken — die neue Szene übernimmt dessen Look.
              </p>
              <div className="gw-imgedit__grid">
                {refs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`gw-imgedit__gridItem${selectedRef === r.id ? " gw-imgedit__gridItem--active" : ""}`}
                    title={r.description || (r.ai ? "KI-generiert" : "Echtes Foto")}
                    disabled={busy || done}
                    onClick={() => setSelectedRef(selectedRef === r.id ? null : r.id)}
                  >
                    <img src={r.thumb} alt={r.description || "Referenz"} loading="lazy" />
                    {!r.ai && <span className="gw-imgedit__badge">Foto</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="gw-imgedit__actions">
            <button type="submit" className="btn btn-primary text-xs px-3 py-1.5" disabled={busy || done || !scene.trim()}>
              {done ? "Fertig, Seite lädt neu …" : busy
                ? (selectedRef ? "Generiert aus Vorlage auf deinem Mac … (3–5 Min)" : "Generiert auf deinem Mac … (1–3 Min)")
                : (selectedRef ? "Neue Szene aus Vorlage generieren" : "Bild generieren")}
            </button>
          </div>
        </form>
      )}

      {openSlot && mode === "reference" && (
        <div className="gw-imgedit__panel">
          {refs === null && <p className="text-xs text-muted-foreground">Lade Referenzbilder …</p>}
          {Array.isArray(refs) && refs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Noch keine Referenzbilder vorhanden — im Admin unter Media Hub hochladen oder Drive verbinden.
            </p>
          )}
          {Array.isArray(refs) && refs.length > 0 && (
            <div className="gw-imgedit__grid">
              {refs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="gw-imgedit__gridItem"
                  title={r.description || (r.ai ? "KI-generiert" : "Echtes Foto")}
                  disabled={busy || done}
                  onClick={() => submit({ token, which: openSlot, mode: "reference", referenceId: r.id })}
                >
                  <img src={r.thumb} alt={r.description || "Referenz"} loading="lazy" />
                  {!r.ai && <span className="gw-imgedit__badge">Foto</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {busy && mode !== "generate" && <p className="text-xs text-muted-foreground mt-2">Übernehme Bild …</p>}
      {done && <p className="text-xs text-muted-foreground mt-2">Fertig, Seite lädt neu …</p>}
      {error && <p className="gw-edit-panel__error mt-2" role="alert">{error}</p>}
    </div>
  );
}
