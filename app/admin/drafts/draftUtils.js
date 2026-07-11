/**
 * Gemeinsame Client-Helper fuer den Draft-Review-Workspace (/admin/drafts).
 * Reine Funktionen, keine Server-Imports.
 */

/** Datum als tt.mm.yyyy (deutsche UI-Regel, nie ISO roh). */
export function fmtDatumDE(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Datum + Uhrzeit als tt.mm.yyyy, HH:MM. */
export function fmtDatumZeitDE(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${fmtDatumDE(date)}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

export function statusBadgeClass(status) {
  if (status === "published") return "badge badge-success";
  if (status === "rejected") return "badge badge-error";
  if (status === "draft_review") return "badge badge-warning";
  return "badge badge-neutral";
}

export function statusLabel(status) {
  if (status === "published") return "Live";
  if (status === "rejected") return "Verworfen";
  if (status === "draft_review") return "Review";
  if (status === "draft") return "Draft";
  if (status === "failed") return "Fehler";
  return status || "—";
}

export function qaScoreBadgeClass(score) {
  if (score == null) return "badge badge-neutral";
  if (score >= 8) return "badge badge-success";
  if (score >= 6) return "badge badge-warning";
  return "badge badge-error";
}

export function gateLabel(status) {
  if (status === "ready_for_approval") return "bereit";
  if (status === "needs_revision") return "nacharbeiten";
  if (status === "review") return "prüfen";
  return status || null;
}

export function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function readingMinutes(html) {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** HTML → lesbarer Plain-Text (fuer Kopieren-Buttons). */
export function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** In die Zwischenablage kopieren (mit Fallback fuer aeltere Browser). */
export async function copyToClipboard(text) {
  const value = String(text || "");
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const el = document.createElement("textarea");
  el.value = value;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
    return true;
  } finally {
    document.body.removeChild(el);
  }
}

/** fetch-Wrapper: wirft Error mit sinnvoller Meldung bei !ok. */
export async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    const msg = json?.detail || json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
