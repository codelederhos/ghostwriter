"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { qaScoreBadgeClass, gateLabel } from "../draftUtils";

/**
 * QA & Risiken: farbige Check-Zeilen aus qa_issues.checks
 * ({id, label, passed, severity, message}) + Legacy-Issues-Liste. Keine JSON-Dumps.
 */
export default function QaTab({ post }) {
  const qa = post.qa || {};
  const checks = Array.isArray(qa.checks) ? qa.checks : [];
  const issues = Array.isArray(qa.issues) ? qa.issues : [];

  const failedCritical = checks.filter((c) => !c.passed && c.severity === "critical").length;
  const failedOther = checks.filter((c) => !c.passed && c.severity !== "critical").length;

  return (
    <div className="min-w-0 space-y-6">
      {/* Kopf: Score + Gate */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={qaScoreBadgeClass(qa.score ?? post.qa_score)}>
          Score {qa.score ?? post.qa_score ?? "—"}/10
        </span>
        {gateLabel(qa.status) && (
          <span className={`badge ${qa.status === "ready_for_approval" ? "badge-success" : qa.status === "needs_revision" ? "badge-error" : "badge-warning"}`}>
            Gate: {gateLabel(qa.status)}
          </span>
        )}
        {checks.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {checks.length - failedCritical - failedOther} von {checks.length} Checks bestanden
          </span>
        )}
      </div>

      {/* Checks */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">QA-Checks</h3>
        {checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine strukturierten QA-Checks hinterlegt.</p>
        ) : (
          <div className="space-y-2">
            {checks.map((check, index) => {
              const failed = !check.passed;
              const critical = failed && check.severity === "critical";
              const rowClass = failed
                ? critical
                  ? "border-red-200 bg-red-50"
                  : "border-amber-200 bg-amber-50"
                : "border-emerald-200 bg-emerald-50";
              const textClass = failed ? (critical ? "text-red-800" : "text-amber-800") : "text-emerald-800";
              const Icon = failed ? (critical ? XCircle : AlertTriangle) : CheckCircle2;
              return (
                <div
                  key={check.id || index}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${rowClass}`}
                >
                  <Icon size={16} className={`mt-0.5 shrink-0 ${textClass}`} />
                  <div className="min-w-0">
                    <p className={`break-words text-sm font-semibold ${textClass}`}>
                      {check.label || check.id}
                      <span className="ml-2 text-xs font-medium opacity-70">
                        {failed ? (critical ? "Blockiert" : "Warnung") : "OK"}
                      </span>
                    </p>
                    {check.message && (
                      <p className="mt-0.5 break-words text-sm text-foreground/80">{check.message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legacy-/Zusatz-Issues */}
      {issues.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Hinweise</h3>
          <ul className="space-y-2">
            {issues.map((issue, index) => (
              <li
                key={index}
                className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-800" />
                <span className="break-words text-sm text-amber-900">{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LLM-Notiz */}
      {qa.llmNote && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">KI-Anmerkung</h3>
          <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground/80">
            {qa.llmNote}
          </p>
        </div>
      )}

      {/* Publish-Fehler aus frueheren Versuchen */}
      {post.review_publish_error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-red-800">Letzter Publish-Fehler</p>
          <p className="mt-0.5 break-words text-sm text-red-900">{post.review_publish_error}</p>
        </div>
      )}
    </div>
  );
}
