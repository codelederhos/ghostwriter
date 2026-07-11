"use client";

import { useEffect, useState } from "react";
import { X, Trash2, Plus, Sparkles, Code, ImageIcon } from "lucide-react";
import { apiJson } from "../draftUtils";

/**
 * Section-Editor (Bearbeiten-Modus des Artikel-Tabs).
 * Meta-Form + Hero-Bild + Sektionen (KI umschreiben / HTML / löschen) +
 * Einfüge-Zeilen zwischen den Sektionen. Portiert aus dem Baurimmo-DraftEditor,
 * Design auf Ghostwriter-Admin-Klassen umgestellt.
 */
export default function SectionEditor({ draftId, post, sections, onUpdate, onClose }) {
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Artikel bearbeiten</h2>
        <button className="btn-outline" onClick={onClose}>
          <X size={14} /> Zur Ansicht
        </button>
      </div>

      <MetaForm draftId={draftId} post={post} onUpdate={onUpdate} />
      <HeroImageBlock draftId={draftId} post={post} onUpdate={onUpdate} />

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Sektionen ({sections.length})</h3>
        <p className="text-xs text-muted-foreground">
          Der Artikel ist an den H2-Überschriften in Sektionen geteilt. Änderungen werden serverseitig bereinigt gespeichert.
        </p>
      </div>

      <div className="space-y-3">
        <InsertRow draftId={draftId} afterIdx={-1} onUpdate={onUpdate} />
        {sections.map((section) => (
          <div key={`${section.idx}-${section.html.length}`} className="space-y-3">
            <SectionRow
              draftId={draftId}
              section={section}
              canDelete={sections.length > 1}
              onUpdate={onUpdate}
            />
            <InsertRow draftId={draftId} afterIdx={section.idx} onUpdate={onUpdate} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Meta-Form

function MetaForm({ draftId, post, onUpdate }) {
  const [form, setForm] = useState({
    title: post.blog_title || "",
    title_tag: post.blog_title_tag || "",
    meta_description: post.blog_meta_description || "",
    slug: post.blog_slug || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm({
      title: post.blog_title || "",
      title_tag: post.blog_title_tag || "",
      meta_description: post.blog_meta_description || "",
      slug: post.blog_slug || "",
    });
  }, [post.blog_title, post.blog_title_tag, post.blog_meta_description, post.blog_slug]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onUpdate(json);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h3 className="mb-3 text-sm font-semibold">Meta</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Titel</label>
          <input className="form-input" value={form.title} onChange={set("title")} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Title-Tag (SEO)</label>
          <input className="form-input" value={form.title_tag} onChange={set("title_tag")} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Slug</label>
          <input className="form-input" value={form.slug} onChange={set("slug")} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Meta-Description</label>
          <textarea className="form-textarea" value={form.meta_description} onChange={set("meta_description")} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Speichere..." : "Meta speichern"}
        </button>
        {saved && <span className="text-sm font-medium text-emerald-700">Gespeichert</span>}
        {error && <span className="break-words text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Hero-Bild

function HeroImageBlock({ draftId, post, onUpdate }) {
  const [url, setUrl] = useState(post.image_url || "");
  const [alt, setAlt] = useState(post.image_alt_text || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, setBusy] = useState(null); // "save" | "ai" | null
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setUrl(post.image_url || "");
    setAlt(post.image_alt_text || "");
  }, [post.image_url, post.image_alt_text]);

  const save = async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, alt }),
      });
      onUpdate(json);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("ai");
    setError(null);
    setSaved(false);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      onUpdate(json);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ImageIcon size={15} /> Hero-Bild
      </h3>
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="aspect-[16/9] overflow-hidden rounded-lg bg-muted sm:aspect-auto sm:h-28">
          {post.image_url ? (
            <img src={post.image_url} alt={post.image_alt_text || ""} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Kein Bild</div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <input
            className="form-input"
            placeholder="Bild-URL (https://... oder /uploads/...)"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
          />
          <input
            className="form-input"
            placeholder="Alt-Text"
            value={alt}
            onChange={(e) => { setAlt(e.target.value); setSaved(false); }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-outline" onClick={save} disabled={Boolean(busy) || !url.trim()}>
              {busy === "save" ? "Speichere..." : "Bild speichern"}
            </button>
            {saved && <span className="text-sm font-medium text-emerald-700">Gespeichert</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              className="form-input flex-1 min-w-[180px]"
              placeholder="KI-Prompt für neues Hero-Bild (min. 10 Zeichen)"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            <button className="btn-outline" onClick={generate} disabled={Boolean(busy) || aiPrompt.trim().length < 10}>
              <Sparkles size={14} /> {busy === "ai" ? "Generiere..." : "KI-Bild generieren"}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="mt-2 break-words text-sm text-red-700">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- Sektion-Row

function SectionRow({ draftId, section, canDelete, onUpdate }) {
  const idx = section.idx;

  const [panel, setPanel] = useState(null); // "ki" | "html" | null
  const [wish, setWish] = useState("");
  const [html, setHtml] = useState(section.html || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [busy, setBusy] = useState(null); // "regen" | "save" | "delete" | "accept" | null
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setHtml(section.html || ""); }, [section.html]);

  const runRegenerate = async () => {
    const w = wish.trim();
    if (!w) { setError("Bitte einen Änderungswunsch eingeben."); return; }
    setPanel(null);
    setError(null);
    setProposal(null);
    setBusy("regen");
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/section/${idx}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wish: w }),
      });
      setProposal(json.new_html);
      setWish("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const saveHtml = async (value) => {
    setBusy(proposal != null ? "accept" : "save");
    setError(null);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/section/${idx}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: value }),
      });
      setProposal(null);
      setPanel(null);
      onUpdate(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    setError(null);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/section/${idx}`, { method: "DELETE" });
      onUpdate(json);
    } catch (e) {
      setError(e.message);
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-sm">#{idx} {section.title || "(ohne Titel)"}</strong>
        <div className="flex gap-1">
          <button
            className="btn-ghost px-2 py-1.5"
            title="KI umschreiben"
            onClick={() => { setPanel(panel === "ki" ? null : "ki"); setError(null); }}
            disabled={Boolean(busy)}
          >
            <Sparkles size={15} />
          </button>
          <button
            className="btn-ghost px-2 py-1.5"
            title="HTML bearbeiten"
            onClick={() => { setPanel(panel === "html" ? null : "html"); setHtml(section.html || ""); setError(null); }}
            disabled={Boolean(busy)}
          >
            <Code size={15} />
          </button>
          {canDelete && (
            <button
              className="btn-ghost px-2 py-1.5 text-red-600 hover:text-red-700"
              title="Sektion löschen"
              onClick={() => setConfirmDelete(true)}
              disabled={Boolean(busy)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <span className="text-sm font-medium text-red-800">Diese Sektion wirklich löschen?</span>
          <button className="btn-destructive px-3 py-1.5" onClick={doDelete} disabled={busy === "delete"}>
            {busy === "delete" ? "Lösche..." : "Löschen"}
          </button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => setConfirmDelete(false)} disabled={busy === "delete"}>
            Abbrechen
          </button>
        </div>
      )}

      {panel === "ki" && (
        <div className="mb-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <label className="block text-xs font-medium text-muted-foreground">Was soll die KI ändern?</label>
          <textarea
            className="form-textarea"
            placeholder="z. B. kürzer fassen, persönlicherer Ton, Beispiel ergänzen..."
            value={wish}
            onChange={(e) => setWish(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={runRegenerate} disabled={!wish.trim()}>
              <Sparkles size={14} /> Umschreiben lassen
            </button>
            <button className="btn-ghost" onClick={() => setPanel(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {panel === "html" && (
        <div className="mb-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <label className="block text-xs font-medium text-muted-foreground">HTML der Sektion</label>
          <textarea
            className="form-textarea min-h-[200px] font-mono text-xs"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => saveHtml(html)} disabled={busy === "save"}>
              {busy === "save" ? "Speichere..." : "Speichern"}
            </button>
            <button className="btn-ghost" onClick={() => setPanel(null)} disabled={busy === "save"}>Abbrechen</button>
          </div>
        </div>
      )}

      {busy === "regen" ? (
        <div className="space-y-2 py-2" aria-live="polite">
          <p className="text-sm text-muted-foreground">KI schreibt die Sektion neu ...</p>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${95 - i * 12}%` }} />
          ))}
        </div>
      ) : proposal != null ? (
        <div className="space-y-2">
          <span className="badge badge-warning">Neuer Vorschlag: noch nicht gespeichert</span>
          <div
            className="blog-prose max-h-80 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-sm break-words"
            dangerouslySetInnerHTML={{ __html: proposal }}
          />
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">HTML-Quelle anzeigen / nachbearbeiten</summary>
            <textarea
              className="form-textarea mt-2 min-h-[160px] font-mono text-xs"
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
            />
          </details>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => saveHtml(proposal)} disabled={busy === "accept"}>
              {busy === "accept" ? "Speichere..." : "Übernehmen"}
            </button>
            <button className="btn-ghost" onClick={() => setProposal(null)} disabled={busy === "accept"}>
              Verwerfen
            </button>
          </div>
        </div>
      ) : (
        <div
          className="blog-prose break-words text-sm [&_table]:block [&_table]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: section.html || "" }}
        />
      )}

      {error && <p className="mt-2 break-words text-sm text-red-700">{error}</p>}
    </div>
  );
}

// ----------------------------------------------------------- Einfüge-Zeile

function InsertRow({ draftId, afterIdx, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("ki"); // "ki" | "html"
  const [prompt, setPrompt] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const doInsert = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { afterIdx };
      if (mode === "html") body.html = html;
      else body.prompt = prompt;
      const json = await apiJson(`/api/admin/drafts/${draftId}/section/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setOpen(false);
      setPrompt("");
      setHtml("");
      onUpdate(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex justify-center">
        <button
          className="btn-ghost text-xs"
          onClick={() => { setOpen(true); setError(null); }}
          disabled={busy}
        >
          <Plus size={13} /> {busy ? "Erzeuge Sektion..." : "Sektion einfügen"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            className={`btn-ghost px-3 py-1.5 text-xs ${mode === "ki" ? "bg-muted font-semibold text-foreground" : ""}`}
            onClick={() => setMode("ki")}
          >
            <Sparkles size={13} /> Per KI
          </button>
          <button
            className={`btn-ghost px-3 py-1.5 text-xs ${mode === "html" ? "bg-muted font-semibold text-foreground" : ""}`}
            onClick={() => setMode("html")}
          >
            <Code size={13} /> Eigenes HTML
          </button>
        </div>
        <button className="btn-ghost px-2 py-1.5" onClick={() => setOpen(false)} disabled={busy}>
          <X size={14} />
        </button>
      </div>

      {mode === "ki" ? (
        <textarea
          className="form-textarea"
          placeholder="Was soll die neue Sektion behandeln? (min. 3 Zeichen)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      ) : (
        <textarea
          className="form-textarea min-h-[140px] font-mono text-xs"
          placeholder="<h2>Überschrift</h2><p>Inhalt ...</p>"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          onClick={doInsert}
          disabled={busy || (mode === "ki" ? prompt.trim().length < 3 : !html.trim())}
        >
          {busy ? (mode === "ki" ? "KI schreibt..." : "Füge ein...") : "Einfügen"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>
      </div>
      {error && <p className="break-words text-sm text-red-700">{error}</p>}
    </div>
  );
}
