/**
 * Step 5: PUBLISHER
 * Publishes blog + GBP post + sends reports
 */

import { sendTelegramReport } from "../../reporters/telegram.js";
import { sendEmailReport } from "../../reporters/email.js";
import { getValidGoogleToken } from "../../google/oauth.js";

/**
 * @param {object} tenant - Tenant record
 * @param {object} settings - Decrypted tenant settings
 * @param {object} profile - Tenant profile
 * @param {object} post - ghostwriter_posts record
 * @param {object} image - { url, localPath }
 * @returns {object} { blogUrl, gbpPostId }
 */
export async function runPublisher(tenant, settings, profile, post, image) {
  const blogUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/${tenant.slug}/${post.language}/blog/${post.blog_slug}`;

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

  // d) Client Push (Webhook zu Client-Website)
  if (settings.client_push_enabled && settings.client_api_url) {
    try {
      await pushToClientApi(settings, post, blogUrl);
    } catch (err) {
      console.error("[Publisher] Client push error:", err.message);
    }
  }

  return { blogUrl, gbpPostId };
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
        primary_keyword: post.blog_primary_keyword,
        category: post.category,
        language: post.language,
        image_url: post.image_url,
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
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GBP API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.name || null;
}
