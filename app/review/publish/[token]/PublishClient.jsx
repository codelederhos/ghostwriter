"use client";

/**
 * Client-Komponente: löst die Veröffentlichung per POST an /api/review/publish aus.
 * Loading-State + Fehler inline, Erfolgszustand mit Link zum publizierten Artikel.
 */

import { useState } from "react";

export default function PublishClient({ token }) {
  const [state, setState] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handlePublish() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/review/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok && data?.ok) {
        setResult(data);
        setState("success");
      } else {
        setError(data?.error || "Veröffentlichung fehlgeschlagen. Bitte erneut versuchen.");
        setState("error");
      }
    } catch {
      setError("Netzwerkfehler. Bitte Verbindung prüfen und erneut versuchen.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-800 mb-2">
          {result?.alreadyPublished
            ? "Der Artikel war bereits veröffentlicht."
            : "Artikel erfolgreich veröffentlicht."}
        </p>
        {result?.blogUrl ? (
          <a href={result.blogUrl} className="btn-primary no-underline">
            Artikel ansehen
          </a>
        ) : (
          <p className="text-sm text-emerald-800 mb-0">Der Artikel ist jetzt live.</p>
        )}
        {result?.publishError && (
          <p className="text-xs text-amber-800 mt-3 mb-0">
            Hinweis: Der Artikel ist live, aber ein nachgelagerter Schritt meldete einen Fehler.
            Das Team prüft das automatisch.
          </p>
        )}
        {result?.visualQa && (
          <p className={`text-xs mt-3 mb-0 ${result.visualQa.ok ? "text-emerald-800" : "text-amber-800"}`}>
            {result.visualQa.ok
              ? `Visuelle Live-Prüfung bestanden (${result.visualQa.findings?.score ?? "–"}/100).`
              : result.visualQa.executed
                ? `Visuelle Live-Prüfung meldet Nacharbeit (${result.visualQa.findings?.score ?? "–"}/100). Das Team wurde informiert.`
                : "Visuelle Live-Prüfung konnte nicht abgeschlossen werden. Das Team wurde informiert."}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        onClick={handlePublish}
        disabled={state === "loading"}
      >
        {state === "loading" ? "Wird veröffentlicht…" : "Jetzt veröffentlichen"}
      </button>
      {state === "error" && (
        <p className="text-sm text-red-700 mt-3 mb-0 break-words" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
