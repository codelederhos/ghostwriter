/**
 * Zentraler Review-Publish-Flow.
 * Wird vom Admin-Workspace (/api/admin/drafts/[id]/publish) und vom
 * Token-Endpoint (/api/review/publish) gemeinsam benutzt.
 */

import crypto from "crypto";
import { query } from "../db.js";
import { loadTenant } from "../pipeline/index.js";
import { runPublisher } from "../pipeline/steps/publisher.js";

const BASE_URL = () => process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de";

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

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
  // blog_url = öffentliche URL auf der Tenant-Domain (z.B. code-lederhos.de/blog/slug);
  // Ghostwriter-Tenant-Blog nur als Fallback ohne konfigurierte Domain.
  const blogUrl = tenant.domain
    ? `https://${String(tenant.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/blog/${post.blog_slug}`
    : `${BASE_URL()}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;

  await query(
    `UPDATE ghostwriter_posts
     SET status = 'published', published_at = NOW(), blog_url = $2,
         reviewed_at = NOW(), review_publish_token_used_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [postId, blogUrl]
  );

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

  await query(
    `UPDATE ghostwriter_posts SET review_publish_result = $2, review_publish_error = $3 WHERE id = $1`,
    [postId, JSON.stringify({ source, publishedAt: new Date().toISOString(), gbpPostId: publisherResult?.gbpPostId || null }), publishError]
  );

  return { ok: true, blogUrl, gbpPostId: publisherResult?.gbpPostId || null, publishError };
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
  return { ok: true, rejected: true };
}
