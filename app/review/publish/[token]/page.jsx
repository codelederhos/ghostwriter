/**
 * Bestätigungsseite für die Veröffentlichung per Publish-Token.
 * Server-Komponente: löst den Token auf und zeigt Titel, Tenant und QA-Score.
 * Der eigentliche POST läuft über die Client-Komponente PublishClient
 * gegen /api/review/publish (fail-closed, siehe route.js).
 */

import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { findPostByReviewToken } from "@/lib/review/publish";
import PublishClient from "./PublishClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Artikel veröffentlichen — Ghostwriter",
  robots: { index: false, follow: false },
};

const TOKEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function fmtDatumDE(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function parseQa(value) {
  if (!value) return null;
  if (Array.isArray(value)) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function scoreBadgeClass(score) {
  if (score == null) return "badge badge-neutral";
  if (score >= 8) return "badge badge-success";
  if (score >= 5) return "badge badge-warning";
  return "badge badge-error";
}

export default async function ReviewPublishPage(props) {
  const params = await props.params;
  let token = params?.token || "";
  try {
    token = decodeURIComponent(token);
  } catch {
    // Hash-Vergleich schlägt bei kaputtem Token einfach fehl
  }

  const post = await findPostByReviewToken("publish", token);
  if (!post) notFound();

  const { rows: [tenant] } = await query(
    "SELECT id, name, slug FROM tenants WHERE id = $1",
    [post.tenant_id]
  );

  const qa = parseQa(post.qa_issues);
  const gateStatus = qa?.gate_status || qa?.status || null;
  const qaScore = post.qa_score != null ? Number(post.qa_score) : (qa?.score != null ? Number(qa.score) : null);
  const showWarning = (qaScore != null && qaScore < 5) || gateStatus === "needs_revision";

  // Zustand vorab bestimmen (die API prüft alles nochmal fail-closed serverseitig)
  const createdAt = post.review_publish_token_created_at
    ? new Date(post.review_publish_token_created_at)
    : null;
  const tokenExpired = !createdAt || Number.isNaN(createdAt.getTime())
    || Date.now() - createdAt.getTime() > TOKEN_MAX_AGE_MS;

  let state = "ready";
  if (post.status === "published") state = "published";
  else if (post.review_publish_token_used_at) state = "used";
  else if (tokenExpired) state = "expired";
  else if (post.status !== "draft_review") state = "unavailable";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="max-w-xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-lg break-words">{tenant?.name || "Ghostwriter"}</span>
          <span className="badge badge-neutral">Freigabe</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10 min-w-0">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm min-w-0">
          <h1 className="text-xl font-bold mb-1 break-words">
            {post.blog_title || "Ohne Titel"}
          </h1>
          <p className="text-sm text-muted-foreground mb-4 flex flex-wrap items-center gap-2">
            {post.category && <span>{post.category}</span>}
            {post.category && <span className="text-muted-foreground/40">&middot;</span>}
            {post.language && <span className="uppercase tracking-wider">{post.language}</span>}
            {post.language && <span className="text-muted-foreground/40">&middot;</span>}
            <span>Erstellt am {fmtDatumDE(post.created_at)}</span>
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className={scoreBadgeClass(qaScore)}>
              QA-Score: {qaScore != null ? `${qaScore}/10` : "–"}
            </span>
            {gateStatus === "needs_revision" && (
              <span className="badge badge-error">Nacharbeit empfohlen</span>
            )}
            {gateStatus === "ready_for_approval" && (
              <span className="badge badge-success">Bereit zur Freigabe</span>
            )}
          </div>

          {state === "ready" && showWarning && (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Achtung: Die Qualitätsprüfung empfiehlt Nacharbeit.
              </p>
              <p className="text-sm text-amber-800 mb-0">
                {qaScore != null && qaScore < 5
                  ? `Der QA-Score liegt bei ${qaScore}/10. `
                  : ""}
                Du kannst trotzdem veröffentlichen — bitte vorher die Vorschau prüfen.
              </p>
            </div>
          )}

          {state === "published" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800 mb-2">
                Dieser Artikel ist bereits veröffentlicht.
              </p>
              {post.blog_url ? (
                <a href={post.blog_url} className="btn-primary no-underline">Artikel ansehen</a>
              ) : (
                <p className="text-sm text-emerald-800 mb-0">Der Artikel ist live.</p>
              )}
            </div>
          )}

          {state === "used" && (
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="text-sm text-muted-foreground mb-0">
                Dieser Freigabe-Link wurde bereits verwendet und ist nicht mehr gültig.
              </p>
            </div>
          )}

          {state === "expired" && (
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="text-sm text-muted-foreground mb-0">
                Dieser Freigabe-Link ist abgelaufen (älter als 14 Tage).
                Bitte eine neue Benachrichtigung anfordern.
              </p>
            </div>
          )}

          {state === "unavailable" && (
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="text-sm text-muted-foreground mb-0">
                Dieser Artikel kann nicht mehr über diesen Link veröffentlicht werden.
              </p>
            </div>
          )}

          {state === "ready" && <PublishClient token={token} />}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Die Veröffentlichung schaltet den Artikel auf dem Tenant-Blog live und
          stößt die angeschlossenen Kanäle an. Zum Prüfen vorher den Vorschau-Link
          aus der Benachrichtigung nutzen.
        </p>
      </main>
    </div>
  );
}
