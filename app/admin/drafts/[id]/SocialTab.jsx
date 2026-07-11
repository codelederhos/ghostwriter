"use client";

import { useState } from "react";
import { Copy, Check, Sparkles } from "lucide-react";
import { apiJson, copyToClipboard } from "../draftUtils";

const PLATFORM_CONFIG = {
  linkedin: { label: "LinkedIn", avatarClass: "bg-[#0a66c2]", meta: "Beitrag · Jetzt", maxChars: 1300 },
  facebook: { label: "Facebook", avatarClass: "bg-[#1877f2]", meta: "vor wenigen Minuten", maxChars: 800 },
  instagram: {
    label: "Instagram",
    avatarClass: "bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af]",
    meta: "Original-Audio",
    maxChars: 1000,
  },
  gbp: { label: "Google Business", avatarClass: "bg-[#1a73e8]", meta: "Neuigkeit", maxChars: 300 },
};

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
}

function BrandHeader({ platform, tenantName }) {
  const cfg = PLATFORM_CONFIG[platform];
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${cfg.avatarClass}`}>
        {initials(tenantName)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{tenantName}</p>
        <p className="text-xs text-muted-foreground">{cfg.meta}</p>
      </div>
    </div>
  );
}

/** Plattform-Preview-Card (LinkedIn/Facebook/Instagram/GBP) im Tenant-Branding. */
function PlatformCard({ platform, text, imageUrl, imageAlt, tenantName }) {
  const empty = <span className="text-muted-foreground">Noch kein Text vorbereitet.</span>;

  if (platform === "instagram") {
    return (
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="p-2.5"><BrandHeader platform="instagram" tenantName={tenantName} /></div>
        <div className="aspect-square w-full bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={imageAlt || ""} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Kein Bild</div>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">
          {text || empty}
        </div>
      </div>
    );
  }

  if (platform === "gbp") {
    return (
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {imageUrl && <img src={imageUrl} alt={imageAlt || ""} className="h-44 w-full object-cover" />}
        <div className="p-3.5">
          <BrandHeader platform="gbp" tenantName={tenantName} />
          <div className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{text || empty}</div>
          <button type="button" disabled className="mt-3.5 w-full cursor-default rounded-full border border-border py-2 text-sm font-medium text-[#1a73e8]">
            Mehr erfahren
          </button>
        </div>
      </div>
    );
  }

  const isLinkedin = platform === "linkedin";
  return (
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="p-3">
        <BrandHeader platform={platform} tenantName={tenantName} />
        <div className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{text || empty}</div>
      </div>
      {imageUrl && <img src={imageUrl} alt={imageAlt || ""} className="max-h-72 w-full object-cover" />}
      {isLinkedin && (
        <div className="flex justify-around border-t border-border/70 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Gefällt mir</span><span>Kommentieren</span><span>Teilen</span><span>Senden</span>
        </div>
      )}
    </div>
  );
}

/**
 * Social-Tab: Preview-Card + editierbarer Text + KI-Neuschreiben + Speichern + Kopieren.
 * platform: "linkedin" | "facebook" | "instagram" | "gbp"
 */
export default function SocialTab({ draftId, post, platform, onUpdate, editable }) {
  const cfg = PLATFORM_CONFIG[platform];
  const initialText = platform === "gbp"
    ? (post.gbp_text || "")
    : (post.social_text?.[platform] || "");

  const [text, setText] = useState(initialText);
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(null); // "regen" | "save" | null
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const regenerate = async () => {
    setBusy("regen");
    setError(null);
    setSaved(false);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/social/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, wish: wish.trim() || undefined }),
      });
      setText(json.text || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const field = platform === "gbp" ? "gbp_text" : platform;
      const json = await apiJson(`/api/admin/drafts/${draftId}/social`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: text }),
      });
      onUpdate(json);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e.message || "Kopieren fehlgeschlagen");
    }
  };

  const overLimit = text.length > cfg.maxChars;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vorschau · {cfg.label}
        </p>
        <PlatformCard
          platform={platform}
          text={text}
          imageUrl={post.image_url}
          imageAlt={post.image_alt_text || post.blog_title}
          tenantName={post.tenant_name || "Tenant"}
        />
      </div>

      {platform === "gbp" && post.gbp_enabled === false && (
        <div className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <strong>Nur vorbereitet:</strong> Google Business ist für diesen Tenant nicht verbunden.
          Der Post wird ohne Freigabe nicht gepostet.
        </div>
      )}

      <div className="max-w-xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Text bearbeiten
          </label>
          <span className={`text-xs ${overLimit ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
            {text.length}/{cfg.maxChars}
          </span>
        </div>
        <textarea
          className="form-textarea min-h-[150px] whitespace-pre-wrap"
          placeholder="Post-Text ..."
          value={text}
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
          readOnly={!editable}
        />
        {editable && (
          <input
            className="form-input"
            placeholder="Wunsch für KI (optional): z. B. kürzer, mehr Call-to-Action, lockerer Ton"
            value={wish}
            onChange={(e) => setWish(e.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <button className="btn-outline" onClick={regenerate} disabled={Boolean(busy)}>
                <Sparkles size={14} /> {busy === "regen" ? "KI schreibt..." : "KI neu schreiben"}
              </button>
              <button className="btn-primary" onClick={save} disabled={Boolean(busy)}>
                {busy === "save" ? "Speichert..." : "Speichern"}
              </button>
            </>
          )}
          <button className="btn-outline" onClick={copy} disabled={!text}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Kopiert" : "Kopieren"}
          </button>
          {saved && <span className="text-sm font-medium text-emerald-700">Gespeichert</span>}
        </div>
        {error && <p className="break-words text-sm text-red-700">Fehler: {error}</p>}
      </div>
    </div>
  );
}
