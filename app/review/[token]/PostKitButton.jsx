"use client";

import { useState } from "react";

/**
 * Ein-Klick-Post-Kit: kopiert den Text ins Clipboard, lädt das Post-Bild
 * herunter und öffnet den Composer der Plattform in einem neuen Tab.
 * Bewusst KEINE Browser-Automation (Multi-Account-fähig, kein Sperr-Risiko) —
 * der Mensch klickt nur noch "Einfügen + Bild anhängen + Posten".
 */
const PLATFORMS = {
  linkedin: {
    // LinkedIn-Composer mit vorbefülltem Text (Clipboard als Fallback)
    url: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(String(text || "").slice(0, 2800))}`,
  },
  facebook: {
    url: (text, articleUrl) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(articleUrl || "")}&quote=${encodeURIComponent(String(text || "").slice(0, 900))}`,
  },
  instagram: {
    url: () => "https://www.instagram.com/",
  },
  gbp: {
    url: () => "https://business.google.com/",
  },
};

export default function PostKitButton({ platform, text, imageUrl, articleUrl }) {
  const [state, setState] = useState("idle");
  const cfg = PLATFORMS[platform];
  if (!cfg) return null;

  async function post() {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch {
      // Clipboard optional — Composer bekommt den Text bei LinkedIn ohnehin per URL
    }
    if (imageUrl) {
      const a = document.createElement("a");
      a.href = imageUrl;
      a.setAttribute("download", "");
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.open(cfg.url(text, articleUrl), "_blank", "noopener");
    setState("done");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button
      type="button"
      onClick={post}
      className="btn btn-primary text-xs px-3 py-1.5 shrink-0"
      title="Text kopieren, Bild laden, Plattform öffnen"
    >
      {state === "done" ? "Kopiert ✓" : "Posten →"}
    </button>
  );
}
