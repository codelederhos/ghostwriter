"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import {
  fmtDatumDE,
  statusBadgeClass,
  statusLabel,
  qaScoreBadgeClass,
  apiJson,
} from "../draftUtils";
import ArticleTab from "./ArticleTab";
import SectionEditor from "./SectionEditor";
import SocialTab from "./SocialTab";
import QaTab from "./QaTab";

const BASE_TABS = [
  { key: "article", label: "Artikel" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "gbp", label: "Google Business" },
  { key: "qa", label: "QA & Risiken" },
];

export default function DraftWorkspace({ draftId }) {
  const router = useRouter();

  const [post, setPost] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [drafts, setDrafts] = useState([]);
  const [activeTab, setActiveTab] = useState("article");
  const [editing, setEditing] = useState(false);

  // Freigeben / Verwerfen
  const [confirmAction, setConfirmAction] = useState(null); // "publish" | "reject" | null
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [publishedUrl, setPublishedUrl] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}`);
      setPost(json.post);
      setSections(Array.isArray(json.sections) ? json.sections : []);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => { load(); }, [load]);

  // Linke Draft-Liste (Navigation zwischen Reviews)
  useEffect(() => {
    fetch("/api/admin/drafts?includeRejected=1")
      .then((r) => r.json())
      .then((data) => setDrafts(Array.isArray(data?.drafts) ? data.drafts : []))
      .catch(() => {});
  }, []);

  /** Mutations-Antworten ({post, sections}) ohne Full-Reload mergen. */
  const applyUpdate = useCallback((json) => {
    if (json?.post) setPost(json.post);
    if (Array.isArray(json?.sections)) setSections(json.sections);
  }, []);

  const tabs = useMemo(() => {
    const hasInstagram = Boolean(post?.social_text?.instagram);
    return BASE_TABS.filter((t) => t.key !== "instagram" || hasInstagram);
  }, [post]);

  useEffect(() => {
    if (!tabs.some((t) => t.key === activeTab)) setActiveTab("article");
  }, [tabs, activeTab]);

  const runPublish = async () => {
    setActionBusy(true);
    setActionError(null);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/publish`, { method: "POST" });
      applyUpdate(json);
      setPublishedUrl(json.blogUrl || null);
      setConfirmAction(null);
      if (json.publishError) setActionError(`Veröffentlicht, aber Publisher-Warnung: ${json.publishError}`);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const runReject = async () => {
    setActionBusy(true);
    setActionError(null);
    try {
      const json = await apiJson(`/api/admin/drafts/${draftId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      applyUpdate(json);
      setConfirmAction(null);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="admin-title">Draft-Review</h1>
        <div className="admin-card animate-pulse space-y-3">
          <div className="h-6 w-2/3 rounded bg-muted" />
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (loadError || !post) {
    return (
      <div>
        <h1 className="admin-title">Draft-Review</h1>
        <div className="admin-card">
          <p className="text-sm text-red-700">Fehler: {loadError || "Draft nicht gefunden."}</p>
          <div className="mt-4 flex gap-2">
            <button className="btn-outline" onClick={load}>Erneut versuchen</button>
            <Link href="/admin/drafts" className="btn-ghost">Zur Liste</Link>
          </div>
        </div>
      </div>
    );
  }

  const isReview = post.status === "draft_review";

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/admin/drafts" className="btn-ghost text-sm">
          <ArrowLeft size={15} /> Alle Drafts
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        {/* Linke Draft-Liste */}
        <aside className="admin-card hidden p-0 overflow-hidden lg:block">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            Drafts ({drafts.length})
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {drafts.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Keine Drafts.</p>
            ) : drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => router.push(`/admin/drafts/${d.id}`)}
                className={`block w-full border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${d.id === post.id ? "bg-muted/50" : ""}`}
              >
                <span className="line-clamp-2 break-words text-sm font-medium">{d.blog_title || "Ohne Titel"}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-neutral">{d.tenant_name}</span>
                  <span className={qaScoreBadgeClass(d.qa_score)}>{d.qa_score ?? "—"}/10</span>
                  {d.status !== "draft_review" && (
                    <span className={statusBadgeClass(d.status)}>{statusLabel(d.status)}</span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{fmtDatumDE(d.created_at)}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Workspace */}
        <div className="admin-card min-w-0 p-0 overflow-hidden">
          {/* Kopf */}
          <div className="border-b border-border p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-neutral">{post.tenant_name}</span>
                  <span className={statusBadgeClass(post.status)}>{statusLabel(post.status)}</span>
                  <span className={qaScoreBadgeClass(post.qa_score)}>QA {post.qa_score ?? "—"}/10</span>
                  <span className="badge badge-neutral">{post.language?.toUpperCase()}</span>
                  {post.is_test && <span className="badge badge-info">Test</span>}
                </div>
                <h1 className="break-words text-xl font-bold leading-tight sm:text-2xl">
                  {post.blog_title || "Ohne Titel"}
                </h1>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  /{post.blog_slug} · erstellt {fmtDatumDE(post.created_at)}
                </p>
              </div>

              {isReview && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-outline text-red-700 border-red-200 hover:bg-red-50"
                    onClick={() => { setConfirmAction("reject"); setActionError(null); }}
                    disabled={actionBusy}
                  >
                    <XCircle size={15} /> Verwerfen
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => { setConfirmAction("publish"); setActionError(null); }}
                    disabled={actionBusy}
                  >
                    <CheckCircle2 size={15} /> Freigeben & veröffentlichen
                  </button>
                </div>
              )}
            </div>

            {/* Bestätigungen */}
            {confirmAction === "publish" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <span className="text-sm font-medium text-emerald-800">
                  Artikel jetzt auf dem Tenant-Blog veröffentlichen?
                </span>
                <button className="btn-primary" onClick={runPublish} disabled={actionBusy}>
                  {actionBusy ? "Veröffentliche..." : "Ja, veröffentlichen"}
                </button>
                <button className="btn-ghost" onClick={() => setConfirmAction(null)} disabled={actionBusy}>
                  Abbrechen
                </button>
              </div>
            )}
            {confirmAction === "reject" && (
              <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-sm font-medium text-red-800">
                  Draft verwerfen? Er taucht nie im Blog auf, bleibt aber zur Doku erhalten.
                </p>
                <input
                  className="form-input"
                  placeholder="Grund (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button className="btn-destructive" onClick={runReject} disabled={actionBusy}>
                    {actionBusy ? "Verwerfe..." : "Ja, verwerfen"}
                  </button>
                  <button className="btn-ghost" onClick={() => setConfirmAction(null)} disabled={actionBusy}>
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {actionError && (
              <p className="mt-3 break-words text-sm text-red-700">{actionError}</p>
            )}
            {(publishedUrl || (post.status === "published" && post.blog_url)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                <CheckCircle2 size={15} />
                <span>Veröffentlicht:</span>
                <a
                  href={publishedUrl || post.blog_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-medium underline underline-offset-2"
                >
                  {publishedUrl || post.blog_url} <ExternalLink size={13} />
                </a>
              </div>
            )}
            {post.status === "rejected" && (
              <p className="mt-3 text-sm text-red-700">
                Dieser Draft wurde verworfen{post.reviewed_at ? ` (${fmtDatumDE(post.reviewed_at)})` : ""}.
              </p>
            )}
          </div>

          {/* Tab-Leiste */}
          <div className="flex overflow-x-auto border-b border-border px-2 sm:px-4" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  activeTab === tab.key
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab-Inhalt */}
          <div className="min-w-0 p-4 sm:p-6">
            {activeTab === "article" && (
              editing ? (
                <SectionEditor
                  draftId={post.id}
                  post={post}
                  sections={sections}
                  onUpdate={applyUpdate}
                  onClose={() => setEditing(false)}
                />
              ) : (
                <ArticleTab post={post} onEdit={isReview ? () => setEditing(true) : null} />
              )
            )}
            {activeTab === "linkedin" && (
              <SocialTab key={`li-${post.id}`} draftId={post.id} post={post} platform="linkedin" onUpdate={applyUpdate} editable={isReview} />
            )}
            {activeTab === "facebook" && (
              <SocialTab key={`fb-${post.id}`} draftId={post.id} post={post} platform="facebook" onUpdate={applyUpdate} editable={isReview} />
            )}
            {activeTab === "instagram" && (
              <SocialTab key={`ig-${post.id}`} draftId={post.id} post={post} platform="instagram" onUpdate={applyUpdate} editable={isReview} />
            )}
            {activeTab === "gbp" && (
              <SocialTab key={`gbp-${post.id}`} draftId={post.id} post={post} platform="gbp" onUpdate={applyUpdate} editable={isReview} />
            )}
            {activeTab === "qa" && <QaTab post={post} />}
          </div>
        </div>
      </div>
    </div>
  );
}
