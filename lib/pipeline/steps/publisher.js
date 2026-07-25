/**
 * Step 5: PUBLISHER
 * Publishes blog + GBP post + sends reports
 */

import { sendTelegramReport } from "../../reporters/telegram.js";
import { sendEmailReport } from "../../reporters/email.js";
import { getValidGoogleToken } from "../../google/oauth.js";
import { query } from "../../db.js";
import { decrypt } from "../../crypto.js";

function absoluteGhostwriterUrl(value) {
  if (!value) return null;
  const url = String(value).trim();
  if (!url) return null;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith("/")) return `${process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de"}${url}`;
  return url;
}

function normalizeGhostwriterHtml(content) {
  if (!content) return content;
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de";
  return String(content)
    .replace(/src=(")\/uploads\//g, `src=$1${base}/uploads/`)
    .replace(/src=(\')\/uploads\//g, `src=$1${base}/uploads/`);
}

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function makeDraftPayload(post, blogUrl, options = {}) {
  const social = parseJsonMaybe(post.social_text, null);
  const qaData = parseJsonMaybe(post.qa_issues, []);
  const qaIssues = Array.isArray(qaData) ? qaData : (qaData?.issues || []);
  return {
    id: post.id,
    ghostwriter_post_id: post.id,
    status: "review",
    title: post.blog_title,
    slug: post.blog_slug,
    meta_description: post.blog_meta_description,
    body: normalizeGhostwriterHtml(post.blog_body),
    primary_keyword: post.blog_primary_keyword,
    category: post.category,
    language: post.language,
    image_url: absoluteGhostwriterUrl(post.image_url),
    image_alt_text: post.image_alt_text,
    image_url_2: absoluteGhostwriterUrl(post.image_url_2),
    image_alt_text_2: post.image_alt_text_2,
    gbp_text: post.gbp_text,
    social_text: social,
    url: blogUrl || null,
    created_at: post.created_at,
    qa: {
      score: post.qa_score,
      issues: Array.isArray(qaIssues) ? qaIssues : [],
      gate: qaData && !Array.isArray(qaData) ? qaData : null,
      checks: qaData && !Array.isArray(qaData) ? (qaData.checks || []) : [],
      autopublish_allowed: qaData && !Array.isArray(qaData) ? qaData.autopublish_allowed === true : false,
      hints: options.qaHints || null,
      reviewMode: true,
    },
    briefing: options.briefing || null,
    briefing_text: options.briefingText || null,
    opportunity_id: options.opportunityId || null,
    brief_id: options.briefId || null,
    recommendation: options.recommendation || null,
  };
}

/**
 * @param {object} tenant - Tenant record
 * @param {object} settings - Decrypted tenant settings
 * @param {object} profile - Tenant profile
 * @param {object} post - ghostwriter_posts record
 * @param {object} image - { url, localPath }
 * @param {object} options - { reviewMode, briefing, opportunityId, briefId }
 * @returns {object} { blogUrl, gbpPostId }
 */
export async function runPublisher(tenant, settings, profile, post, image, options = {}) {
  // Öffentliche Artikel-URL: Die Tenant-Domain NUR, wenn sie den Blog wirklich
  // ausliefert — per Client-Push (Webhook) ODER Domain-Proxy auf den
  // Ghostwriter-Blog (domain_serves_blog, z.B. gabriela-lederhos.de/blog via
  // nginx seit 16.07.2026). Sonst zeigt "Zum Artikel" ins 404-Leere.
  const domainServesBlog = Boolean(settings.client_push_enabled && settings.client_api_url) || settings.domain_serves_blog === true;
  const blogUrl = (tenant.domain && domainServesBlog)
    ? `https://${String(tenant.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/blog/${post.blog_slug}`
    : `${process.env.NEXT_PUBLIC_BASE_URL}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;

  if (options.reviewMode) {
    let reviewPushError = null;
    // Review-Drafts gehen nur an Client-Apps, die den Review selbst verwalten
    // (review_flow='client', z.B. Baurimmo). Core-Review-Tenants behalten den
    // Draft im Ghostwriter-Workspace; Client-Webhooks sehen erst post_published.
    const clientOwnsReview = (settings.review_flow || "core") === "client";
    if (clientOwnsReview && settings.client_push_enabled && settings.client_api_url) {
      try {
        await pushReviewDraftToClient(settings, makeDraftPayload(post, null, options));
      } catch (err) {
        console.error("[Publisher] Review draft client push error:", err.message);
        reviewPushError = err.message;
      }
    }
    return {
      blogUrl: null,
      gbpPostId: null,
      reviewDraft: true,
      pushedToClient: Boolean(clientOwnsReview && settings.client_push_enabled && settings.client_api_url && !reviewPushError),
      reviewPushError,
    };
  }

  // a) Blog is already in DB (published via API route)
  // b) GBP Post — nur wenn gbp_enabled und OAuth vorhanden
  let gbpPostId = null;
  if (settings.gbp_enabled && settings.gbp_refresh_token && settings.gbp_account_id && settings.gbp_location_id) {
    try {
      const accessToken = await getValidGoogleToken(tenant.id, settings);
      gbpPostId = await publishGbpPost(accessToken, settings, post, blogUrl, image);
    } catch (err) {
      console.error("[Publisher] GBP error:", err.message);
    }
  }

  // c) Reports
  const report = {
    tenantName: tenant.name,
    title: post.blog_title,
    language: post.language,
    category: post.category,
    angle: post.angle,
    blogUrl,
    gbpPostId,
    gbpText: post.gbp_text,
    keyword: post.blog_primary_keyword,
  };

  if (settings.telegram_bot_token && settings.telegram_chat_id) {
    try {
      await sendTelegramReport(settings.telegram_bot_token, settings.telegram_chat_id, report);
    } catch (err) {
      console.error("[Publisher] Telegram error:", err.message);
    }
  }

  if (settings.report_email) {
    try {
      await sendEmailReport(settings.report_email, report);
    } catch (err) {
      console.error("[Publisher] Email error:", err.message);
    }
  }

  // d) Client Push (Webhook zu Client-Website) — Fehler wird zurückgegeben,
  // damit der Aufrufer ihn persistiert (sonst: gw published, Kunde leer).
  let clientPushError = null;
  if (settings.client_push_enabled && settings.client_api_url) {
    try {
      await pushToClientApi(settings, post, blogUrl);
    } catch (err) {
      clientPushError = err.message;
      console.error("[Publisher] Client push error:", err.message);
    }
  }

  return { blogUrl, gbpPostId, clientPushError };
}

/**
 * Draft-Kopie im Client-Workspace aktualisieren (review_flow='client', z.B.
 * Baurimmo — Webhook upsertet per ghostwriter_post_id). Nötig nach Bild-/
 * Text-Edits im Review: sonst genehmigt der Kunde einen anderen Stand als
 * den, der bei Publish gepusht wird (Audit 17.07.2026).
 */
export async function syncReviewDraftToClient(postId) {
  const { rows: [row] } = await query(
    `SELECT p.*, ts.client_api_url, ts.client_api_key, ts.client_push_enabled, ts.review_flow
     FROM ghostwriter_posts p JOIN tenant_settings ts ON ts.tenant_id = p.tenant_id
     WHERE p.id = $1`,
    [postId]
  );
  if (!row || row.status !== "draft_review") return false;
  if (!(row.client_push_enabled && row.client_api_url && (row.review_flow || "core") === "client")) return false;
  let apiKey = row.client_api_key;
  if (apiKey) try { apiKey = decrypt(apiKey); } catch { /* schon Klartext */ }
  await pushReviewDraftToClient(
    { client_api_url: row.client_api_url, client_api_key: apiKey },
    makeDraftPayload(row, null, {})
  );
  return true;
}

async function pushReviewDraftToClient(settings, draft) {
  const res = await fetch(settings.client_api_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.client_api_key ? { "Authorization": `Bearer ${settings.client_api_key}` } : {}),
    },
    body: JSON.stringify({
      event: "post_review_draft",
      draft,
      post: draft,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Client API responded ${res.status}`);
}

async function pushToClientApi(settings, post, blogUrl) {
  const res = await fetch(settings.client_api_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.client_api_key ? { "Authorization": `Bearer ${settings.client_api_key}` } : {}),
    },
    body: JSON.stringify({
      event: "post_published",
      post: {
        id: post.id,
        title: post.blog_title,
        slug: post.blog_slug,
        meta_description: post.blog_meta_description,
        body: normalizeGhostwriterHtml(post.blog_body),
        primary_keyword: post.blog_primary_keyword,
        category: post.category,
        language: post.language,
        image_url: absoluteGhostwriterUrl(post.image_url),
        image_alt_text: post.image_alt_text,
        gbp_text: post.gbp_text,
        published_at: post.published_at,
        url: blogUrl,
      },
    }),
    signal: AbortSignal.timeout(10000), // 10s Timeout
  });
  if (!res.ok) throw new Error(`Client API responded ${res.status}`);
}

async function publishGbpPost(accessToken, settings, post, blogUrl, image) {
  const accountLocation = `accounts/${settings.gbp_account_id}/locations/${settings.gbp_location_id}`;

  const body = {
    languageCode: post.language,
    summary: post.gbp_text,
    callToAction: { actionType: "LEARN_MORE", url: blogUrl },
    topicType: "STANDARD",
  };

  if (image?.url) {
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: image.url }];
  }

  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountLocation}/localPosts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GBP API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.name || null;
}
