"use client";

import { useState } from "react";

/** Kopieren-Button für Social-/GBP-Texte in der öffentlichen Vorschau. */
export default function CopyButton({ text, label = "Kopieren" }) {
  const [state, setState] = useState("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text || "");
      setState("done");
    } catch {
      // Fallback für ältere Browser / fehlende Berechtigung
      try {
        const ta = document.createElement("textarea");
        ta.value = text || "";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setState("done");
      } catch {
        setState("error");
      }
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-outline text-xs px-3 py-1.5 shrink-0"
      aria-label={label}
    >
      {state === "done" ? "Kopiert ✓" : state === "error" ? "Fehler" : label}
    </button>
  );
}
