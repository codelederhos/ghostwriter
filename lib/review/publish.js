/**
 * Zentraler Review-Publish-Flow.
 * Wird vom Admin-Workspace (/api/admin/drafts/[id]/publish) und vom
 * Token-Endpoint (/api/review/publish) gemeinsam benutzt.
 */

import crypto from "crypto";
import { query } from "../db.js";
import { decrypt } from "../crypto.js";
import { loadTenant } from "../pipeline/index.js";
import { runPublisher } from "../pipeline/steps/publisher.js";
import { runQaVisual } from "../pipeline/steps/qa_visual.js";
import {
  adminPreviewToken,
  adminPublishToken,
  postIdFromDeterministicToken,
} from "./tokens.js";

export { adminPreviewToken, adminPublishToken } from "./tokens.js";

const BASE_URL = () => process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de";

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Dauerhafte deterministische Tokens (aus post_id + ENCRYPTION_KEY).
 * Rotieren NIE — Telegram-Links sterben nicht mehr durch Re-Notifies
 * (16.07.2026: Stanis Veröffentlichen-Button war 404, weil ältere
 * Telegram-Nachrichten rotierte Publish-Tokens enthielten).
 */
function absoluteUrl(value) {
  if (!value) return null;
  const url = String(value).trim();
  if (!url) return null;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith("/")) return `${BASE_URL()}${url}`;
  return url;
}

/**
 * Post per Preview- oder Publish-Token finden (Token wird nur gehasht verglichen).
 * @param {"preview"|"publish"} kind
 */
export async function findPostByReviewToken(kind, token) {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  const deterministicPostId = postIdFromDeterministicToken(kind, token);
  if (deterministicPostId) {
    const { rows: [post] } = await query("SELECT * FROM ghostwriter_posts WHERE id = $1", [deterministicPostId]);
    return post || null;
  }
  const col = kind === "publish" ? "review_publish_token_hash" : "review_preview_token_hash";
  const { rows: [post] } = await query(
    `SELECT * FROM ghostwriter_posts WHERE ${col} = $1`,
    [hashToken(token)]
  );
  return post || null;
}

/**
 * Freigabe: draft_review -> published.
 * Publiziert auf dem Ghostwriter-Tenant-Blog (Status-Flip) und stoesst danach
 * den regulaeren Publisher an (Client-Push post_published, GBP falls aktiv, Reports).
 * Idempotent: bereits publizierte Posts geben ok+alreadyPublished zurueck.
 */
export async function publishReviewedPost(postId, { source = "admin" } = {}) {
  const { rows: [post] } = await query("SELECT * FROM ghostwriter_posts WHERE id = $1", [postId]);
  if (!post) throw new Error("Draft nicht gefunden");
  if (post.status === "published") {
    return { ok: true, alreadyPublished: true, blogUrl: post.blog_url };
  }
  if (post.status !== "draft_review") {
    throw new Error(`Post ist nicht im Review-Status (aktuell: ${post.status})`);
  }

  const { tenant, settings, profile } = await loadTenant(post.tenant_id);

  // Client-Review-Tenants (z.B. Baurimmo) geben im EIGENEN Workspace frei —
  // der Client lehnt post_published mit 409 ab (ALLOW_DIRECT_PUBLISH=false).
  // Ohne diesen Guard: gw "published", Kundenseite 404 (Stani 23.07.2026).
  if ((settings.review_flow || "core") === "client") {
    throw new Error(
      `Dieser Artikel wird im ${tenant.name}-Workspace freigegeben (eigener Freigabe-Link/Admin) — nicht über diesen Button.`
    );
  }

  // Auch eine manuelle Freigabe darf keine strukturell kaputte Seite live
  // schalten. Gegen die geschützte, statische Draft-Preview prüfen, bevor
  // Status, Client-Push, GBP oder Reports verändert werden.
  const previewUrl = `${BASE_URL()}/review/${adminPreviewToken(postId)}?static=1`;
  const qaPreflight = await runQaVisual({
    tenant,
    settings,
    post: { id: postId },
    blogUrl: previewUrl,
    notifyOnFailure: false,
  });
  if (!qaPreflight.ok) {
    const score = qaPreflight.findings?.score;
    const error = new Error(
      `Visuelle Vorabprüfung fehlgeschlagen${Number.isFinite(score) ? ` (${score}/100)` : ""}. Der Artikel bleibt im Review.`
    );
    error.code = "visual_qa_failed";
    error.qaVisual = qaPreflight;
    throw error;
  }

  // blog_url: Tenant-Domain NUR, wenn sie den Blog wirklich ausliefert
  // (Client-Push ODER domain_serves_blog) — gleicher Guard wie im Publisher,
  // sonst zeigt der Link ins 404-Leere (Audit 17.07.2026).
  const domainServesBlog = Boolean(settings.client_push_enabled && settings.client_api_url) || settings.domain_serves_blog === true;
  const blogUrl = (tenant.domain && domainServesBlog)
    ? `https://${String(tenant.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/blog/${post.blog_slug}/`
    : `${BASE_URL()}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;

  // Atomarer Status-Flip: nur EIN paralleler Aufruf (Doppelklick, Preview-Button
  // + Telegram-Link gleichzeitig) gewinnt — sonst doppelter GBP-Post/Client-Push.
  const { rows: claimed } = await query(
    `UPDATE ghostwriter_posts
     SET status = 'published', published_at = NOW(), blog_url = $2,
         reviewed_at = NOW(), review_publish_token_used_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'draft_review'
     RETURNING id`,
    [postId, blogUrl]
  );
  if (!claimed.length) {
    return { ok: true, alreadyPublished: true, blogUrl };
  }

  let publisherResult = null;
  let publishError = null;
  try {
    publisherResult = await runPublisher(
      tenant,
      settings,
      profile,
      { ...post, status: "published", published_at: new Date() },
      { url: absoluteUrl(post.image_url) },
      {}
    );
  } catch (err) {
    publishError = err.message;
    console.error("[Review/publish] Publisher error:", err.message);
  }
  // Client-Push-Fehler sichtbar machen: gw sagt sonst "published", während der
  // Artikel beim Kunden nie ankam (Audit 17.07.2026, staned-Webhook-Fall).
  if (!publishError && publisherResult?.clientPushError) {
    publishError = `Client-Push fehlgeschlagen: ${publisherResult.clientPushError}`;
  }

  await query(
    `UPDATE ghostwriter_posts SET review_publish_result = $2, review_publish_error = $3 WHERE id = $1`,
    [postId, JSON.stringify({ source, publishedAt: new Date().toISOString(), gbpPostId: publisherResult?.gbpPostId || null, clientPushError: publisherResult?.clientPushError || null }), publishError]
  );

  let qaVisual = null;
  try {
    qaVisual = await runQaVisual({ tenant, settings, post: { id: postId }, blogUrl });
  } catch (error) {
    qaVisual = { ok: false, error: error.message };
  }

  return { ok: true, blogUrl, gbpPostId: publisherResult?.gbpPostId || null, publishError, qaVisual };
}

/**
 * Ablehnen: draft_review -> rejected (bleibt zur Doku erhalten, taucht nie im Blog auf).
 */
export async function rejectReviewedPost(postId, { reason = null } = {}) {
  const { rows: [post] } = await query("SELECT id, status FROM ghostwriter_posts WHERE id = $1", [postId]);
  if (!post) throw new Error("Draft nicht gefunden");
  if (post.status !== "draft_review") {
    throw new Error(`Post ist nicht im Review-Status (aktuell: ${post.status})`);
  }
  await query(
    `UPDATE ghostwriter_posts
     SET status = 'rejected', reviewed_at = NOW(), updated_at = NOW(),
         review_publish_result = $2
     WHERE id = $1`,
    [postId, JSON.stringify({ rejected: true, reason, rejectedAt: new Date().toISOString() })]
  );

  // Client-Workspace synchron halten: bei review_flow='client' liegt eine Kopie
  // des Drafts beim Kunden — ohne dieses Event bleibt sie dort ewig im Review
  // (15.07.2026: 25 Alt-Drafts im Baurimmo-Workspace).
  try {
    const { rows: [cfg] } = await query(
      `SELECT ts.client_api_url, ts.client_api_key, ts.client_push_enabled, ts.review_flow
       FROM ghostwriter_posts p JOIN tenant_settings ts ON ts.tenant_id = p.tenant_id
       WHERE p.id = $1`,
      [postId]
    );
    if (cfg?.client_push_enabled && cfg.client_api_url && cfg.review_flow === "client") {
      let apiKey = cfg.client_api_key;
      if (apiKey) try { apiKey = decrypt(apiKey); } catch { /* schon Klartext */ }
      await fetch(cfg.client_api_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ event: "post_rejected", post: { id: postId } }),
        signal: AbortSignal.timeout(10000),
      });
    }
  } catch (err) {
    console.error("[reject] Client-Sync fehlgeschlagen:", err?.message || err);
  }
  return { ok: true, rejected: true };
}
