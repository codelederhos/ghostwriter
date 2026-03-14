/**
 * Step 5: PUBLISHER
 * Publishes blog + GBP post + sends reports
 */

import { sendTelegramReport } from "../../reporters/telegram.js";
import { sendEmailReport } from "../../reporters/email.js";

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
  // b) GBP Post
  let gbpPostId = null;
  if (settings.gbp_oauth_token && settings.gbp_account_id && settings.gbp_location_id) {
    try {
      gbpPostId = await publishGbpPost(settings, post, blogUrl, image);
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

  return { blogUrl, gbpPostId };
}

async function publishGbpPost(settings, post, blogUrl, image) {
  const accountLocation = `accounts/${settings.gbp_account_id}/locations/${settings.gbp_location_id}`;
  const ctaType = post.category?.default_cta === "CALL" ? "CALL" : "LEARN_MORE";

  const body = {
    languageCode: post.language,
    summary: post.gbp_text,
    callToAction: {
      actionType: ctaType,
      url: blogUrl,
    },
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
        Authorization: `Bearer ${settings.gbp_oauth_token}`,
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
  return data.name || null; // localPost resource name as ID
}
