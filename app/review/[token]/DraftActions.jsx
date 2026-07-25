"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ImageEditor from "./ImageEditor";

/**
 * Draft-Aktionen in der öffentlichen Preview (nur mode="preview" + status
 * draft_review — das gated die Server-Seite, hier wird nicht mehr geprüft):
 *
 *  a) Bleistift-FAB (fixed, unter dem TOC-Button): Edit-Modus. Jede Sektion
 *     bekommt einen dezenten "Neu generieren"-Button; Klick öffnet ein
 *     Inline-Panel mit Anweisungs-Textarea → POST /api/review/section-regenerate.
 *     Bei Erfolg: voller Reload (statt router.refresh), weil BlogWidgets,
 *     Scroll-Reveal und TOC einmalige Effekte auf dangerouslySetInnerHTML-DOM
 *     sind und mit dem neuen HTML frisch hydrieren müssen.
 *
 *  b) Grüner Freigabe-FAB mit Confirm-Dialog → POST /api/review/publish-from-preview.
 *
 * Sektions-Index-Logik: Die Server-Seite übergibt `sections` DIREKT aus
 * splitSections (_lib/workspace.js) — idx 0 = Intro vor dem ersten <h2>, falls
 * vorhanden. Clientseitig werden die h2-Elemente im .blog-prose in
 * Dokument-Reihenfolge den Sektionen mit startsWithH2 zugeordnet; damit ist
 * die Zählung garantiert konsistent mit splitSections/replaceSection.
 *
 * @param {string} token   Preview-Token aus der URL
 * @param {string} domain  Tenant-Domain für den Confirm-Text
 * @param {Array<{idx:number,title:string,startsWithH2:boolean}>} sections
 */
export default function DraftActions({ token, domain, sections = [], images = null }) {
  const [editMode, setEditMode] = useState(false);
  const [slots, setSlots] = useState([]);
  const [mapError, setMapError] = useState(null);

  const [activeIdx, setActiveIdx] = useState(null);
  const [wish, setWish] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState(null);
  const [regenDone, setRegenDone] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishResult, setPublishResult] = useState(null);

  // Edit-Modus: Slot-Container vor jede Sektion ins (dangerouslySetInnerHTML-)DOM
  // hängen; Buttons/Panels werden per Portal hineingerendert.
  useEffect(() => {
    if (!editMode) return;

    const prose = document.querySelector(".blog-prose");
    if (!prose) {
      setMapError("Artikeltext nicht gefunden.");
      return;
    }

    const h2s = Array.from(prose.querySelectorAll("h2"));
    const h2Sections = sections.filter((s) => s.startsWithH2);
    if (h2s.length !== h2Sections.length) {
      // Zählung im DOM weicht von splitSections ab → lieber gar nicht editieren
      setMapError("Sektionen konnten nicht zugeordnet werden. Bitte Seite neu laden.");
      return;
    }

    const created = [];
    const intro = sections.find((s) => !s.startsWithH2);
    if (intro) {
      const container = document.createElement("div");
      container.className = "gw-edit-slot";
      prose.insertBefore(container, prose.firstChild);
      created.push({ idx: intro.idx, title: intro.title, container });
    }
    h2Sections.forEach((s, i) => {
      const container = document.createElement("div");
      container.className = "gw-edit-slot";
      h2s[i].parentNode.insertBefore(container, h2s[i]);
      created.push({ idx: s.idx, title: s.title, container });
    });
    setSlots(created);

    return () => {
      created.forEach((s) => s.container.remove());
      setSlots([]);
      setActiveIdx(null);
      setWish("");
      setRegenError(null);
      setMapError(null);
    };
  }, [editMode, sections]);

  // Escape schließt den Confirm-Dialog (nicht während des Publishes)
  useEffect(() => {
    if (!confirmOpen || publishing) return;
    const onKey = (e) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen, publishing]);

  function openPanel(idx) {
    setActiveIdx(idx);
    setWish("");
    setRegenError(null);
  }

  async function submitRegenerate(e) {
    e.preventDefault();
    const trimmed = wish.trim();
    if (!trimmed || regenLoading || activeIdx == null) return;
    setRegenLoading(true);
    setRegenError(null);
    try {
      const res = await fetch("/api/review/section-regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, idx: activeIdx, wish: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setRegenDone(true);
        // Voller Reload: neuer blog_body + frische Hydration (siehe Kopf-Kommentar)
        window.location.reload();
        return;
      }
      setRegenError(data?.error || "Neu generieren fehlgeschlagen. Bitte erneut versuchen.");
    } catch {
      setRegenError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setRegenLoading(false);
    }
  }

  async function submitPublish() {
    if (publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/review/publish-from-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setPublishResult(data);
      } else {
        setPublishError(data?.error || "Veröffentlichung fehlgeschlagen. Bitte erneut versuchen.");
      }
    } catch {
      setPublishError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setPublishing(false);
    }
  }

  const published = publishResult != null;

  return (
    <>
      {/* Bleistift-FAB: Edit-Modus an/aus */}
      {!published && (
        <button
          type="button"
          className={`gw-edit-fab${editMode ? " gw-edit-fab--active" : ""}`}
          onClick={() => setEditMode((v) => !v)}
          aria-label={editMode ? "Bearbeiten beenden" : "Sektionen bearbeiten"}
          aria-pressed={editMode}
          title={editMode ? "Bearbeiten beenden" : "Sektionen bearbeiten"}
        >
          {editMode ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          )}
        </button>
      )}

      {/* Freigabe-FAB (grün) */}
      <button
        type="button"
        className="gw-publish-fab"
        onClick={() => setConfirmOpen(true)}
        disabled={published}
        aria-label="Freigeben und veröffentlichen"
        title={published ? "Veröffentlicht" : "Freigeben & veröffentlichen"}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>

      {/* Fehler bei der Sektions-Zuordnung */}
      {editMode && mapError && (
        <div className="gw-edit-toast" role="alert">{mapError}</div>
      )}

      {/* Bild-Editor: generieren / Referenz wählen / hochladen */}
      {editMode && images && (
        <div className="gw-imgedit-wrap">
          <ImageEditor token={token} images={images} />
        </div>
      )}

      {/* Pro Sektion: dezenter "Neu generieren"-Button + Inline-Panel (Portale) */}
      {editMode && slots.map((slot) => createPortal(
        <div className="gw-edit-block">
          {activeIdx === slot.idx ? (
            <form className="gw-edit-panel" onSubmit={submitRegenerate}>
              <p className="gw-edit-panel__title">
                Sektion neu generieren: <strong>{slot.title}</strong>
              </p>
              <textarea
                className="form-textarea text-sm"
                rows={3}
                maxLength={2000}
                value={wish}
                autoFocus
                disabled={regenLoading || regenDone}
                onChange={(e) => setWish(e.target.value)}
                placeholder="Was soll anders werden? Z.B. kürzer fassen, konkretes Beispiel ergänzen, sachlicher formulieren …"
              />
              {regenError && <p className="gw-edit-panel__error" role="alert">{regenError}</p>}
              <div className="gw-edit-panel__actions">
                <button
                  type="submit"
                  className="btn btn-primary text-xs px-3 py-1.5"
                  disabled={regenLoading || regenDone || !wish.trim()}
                >
                  {regenDone
                    ? "Fertig, Seite lädt neu …"
                    : regenLoading
                      ? "Wird neu generiert … (bis zu 2 Min.)"
                      : "Neu generieren"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-xs px-3 py-1.5"
                  onClick={() => setActiveIdx(null)}
                  disabled={regenLoading}
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="gw-edit-trigger"
              onClick={() => openPanel(slot.idx)}
              disabled={regenLoading}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              Neu generieren
            </button>
          )}
        </div>,
        slot.container,
        `gw-slot-${slot.idx}`
      ))}

      {/* Confirm-Dialog + Erfolgs-/Fehleranzeige für die Freigabe */}
      {confirmOpen && (
        <div
          className="dw-modal-backdrop"
          onClick={() => { if (!publishing) setConfirmOpen(false); }}
        >
          <div className="dw-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dw-modal-header">
              <h2>{published ? "Veröffentlicht" : "Artikel freigeben?"}</h2>
              <button
                type="button"
                className="dw-icon-btn"
                onClick={() => setConfirmOpen(false)}
                disabled={publishing}
                aria-label="Schließen"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <div className="dw-modal-body">
              {published ? (
                <div className="space-y-3">
                  <p className="text-sm text-foreground">
                    {publishResult.alreadyPublished
                      ? "Der Artikel war bereits veröffentlicht."
                      : "Der Artikel wurde veröffentlicht und die Social-Posts sind vorbereitet."}
                  </p>
                  {publishResult.blogUrl && (
                    <a
                      href={publishResult.blogUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn text-sm text-white bg-emerald-600 hover:bg-emerald-700"
                    >
                      Zum Artikel
                    </a>
                  )}
                  {publishResult.publishError && (
                    <p className="text-xs text-amber-700">
                      Hinweis: Veröffentlicht, aber ein Folgeschritt meldete einen Fehler
                      ({publishResult.publishError}).
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-foreground">
                    Artikel wird auf <strong>{domain || "der Kunden-Domain"}</strong> veröffentlicht
                    und Social-Posts vorbereitet.
                  </p>
                  {publishError && (
                    <p className="text-sm text-red-600" role="alert">{publishError}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <button
                      type="button"
                      className="btn btn-outline text-sm"
                      onClick={() => setConfirmOpen(false)}
                      disabled={publishing}
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      className="btn text-sm text-white bg-emerald-600 hover:bg-emerald-700"
                      onClick={submitPublish}
                      disabled={publishing}
                    >
                      {publishing ? "Wird veröffentlicht …" : "Freigeben & veröffentlichen"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
