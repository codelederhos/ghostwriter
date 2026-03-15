/**
 * Ghostwriter 5-Step Pipeline
 * Orchestrates: Planner → SEO → Writer → Image → Publisher
 */

import { query } from "../db.js";
import { decrypt } from "../crypto.js";
import { runPlanner } from "./steps/planner.js";
import { runSeoResearch } from "./steps/seo.js";
import { runWriter } from "./steps/writer.js";
import { runImageGen } from "./steps/image.js";
import { runPublisher } from "./steps/publisher.js";

/**
 * Load tenant data with decrypted settings
 */
async function loadTenant(tenantId) {
  const { rows: [tenant] } = await query(
    "SELECT * FROM tenants WHERE id = $1 AND status = 'active'",
    [tenantId]
  );
  if (!tenant) throw new Error(`Tenant ${tenantId} not found or inactive`);

  const { rows: [settings] } = await query(
    "SELECT * FROM tenant_settings WHERE tenant_id = $1",
    [tenantId]
  );
  if (!settings) throw new Error(`No settings for tenant ${tenantId}`);

  const { rows: [profile] } = await query(
    "SELECT * FROM tenant_profiles WHERE tenant_id = $1",
    [tenantId]
  );

  const { rows: topics } = await query(
    "SELECT * FROM tenant_topics WHERE tenant_id = $1 AND is_active = true ORDER BY category_id",
    [tenantId]
  );

  // Decrypt sensitive fields
  const decrypted = { ...settings };
  for (const field of ["text_api_key", "image_api_key", "gbp_oauth_token", "gbp_refresh_token"]) {
    if (decrypted[field]) {
      try { decrypted[field] = decrypt(decrypted[field]); } catch { /* leave as-is */ }
    }
  }

  return { tenant, settings: decrypted, profile, topics };
}

/**
 * Log a pipeline step
 */
async function logStep(tenantId, postId, step, status, message, durationMs) {
  await query(
    `INSERT INTO ghostwriter_log (tenant_id, post_id, step, status, message, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, postId, step, status, message, durationMs]
  );
}

/**
 * Run the full pipeline for a tenant
 * @param {string} tenantId - UUID
 * @param {object} options - { preview: bool, language: string|null }
 * @returns {object} Result with post data
 */
export async function runPipeline(tenantId, options = {}) {
  const { preview = false, override = null, isTest = false } = options;
  const data = await loadTenant(tenantId);
  data._override = override;
  data._isTest = isTest || preview;
  const languages = data.profile?.languages || ["de"];
  const results = [];

  for (const lang of languages) {
    const postResult = await runPipelineForLanguage(data, lang, preview);
    results.push(postResult);
  }

  // Update next_run_at
  if (!preview) {
    const hours = data.settings.frequency_hours || 72;
    await query(
      "UPDATE tenant_settings SET next_run_at = NOW() + ($1 || ' hours')::interval WHERE tenant_id = $2",
      [hours, tenantId]
    );
  }

  return { tenantId, results };
}

async function runPipelineForLanguage(data, language, preview) {
  const { tenant, settings, profile, topics } = data;
  const tenantId = tenant.id;
  let postId = null;

  try {
    // Step 1: PLANNER
    let start = Date.now();
    const plan = await runPlanner(topics, language, data._override, tenantId);
    await logStep(tenantId, null, "planner", "success", JSON.stringify(plan), Date.now() - start);

    // Step 2: SEO RESEARCHER
    start = Date.now();
    const seo = await runSeoResearch(settings, plan, profile, language);
    await logStep(tenantId, null, "seo", "success", `Keyword: ${seo.primaryKeyword}`, Date.now() - start);

    // Step 3: WRITER
    start = Date.now();
    const article = await runWriter(settings, plan, seo, profile, language);
    await logStep(tenantId, null, "writer", "success", `Title: ${article.title}`, Date.now() - start);

    // Check for duplicate slug
    const { rows: existing } = await query(
      "SELECT id FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3",
      [tenantId, language, article.slug]
    );
    if (existing.length > 0) {
      article.slug = `${article.slug}-${Date.now().toString(36)}`;
    }

    // Step 4: IMAGE GENERATOR
    start = Date.now();
    let imageResult = { url: null, localPath: null };
    try {
      imageResult = await runImageGen(settings, article, seo);
      await logStep(tenantId, null, "image", "success", imageResult.url, Date.now() - start);
    } catch (err) {
      await logStep(tenantId, null, "image", "error", err.message, Date.now() - start);
      // Continue without image
    }

    // Create post record
    const { rows: [post] } = await query(
      `INSERT INTO ghostwriter_posts
       (tenant_id, language, category, angle, season,
        blog_title, blog_slug, blog_body, blog_title_tag, blog_meta_description,
        blog_primary_keyword, image_url, image_alt_text, gbp_text,
        status, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        tenantId, language, plan.category, plan.angle, plan.season,
        article.title, article.slug, article.body_html,
        article.title_tag, article.meta_description,
        seo.primaryKeyword, imageResult.url,
        `${article.title} - ${seo.primaryKeyword}`,
        article.gbp_text,
        preview ? "draft" : "draft",
        data._isTest || false,
      ]
    );
    postId = post.id;

    // Step 5: PUBLISHER
    if (!preview) {
      start = Date.now();
      const pubResult = await runPublisher(tenant, settings, profile, post, imageResult);
      await logStep(tenantId, postId, "publisher", "success", JSON.stringify(pubResult), Date.now() - start);

      // Update post status
      const blogUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/${tenant.slug}/${language}/blog/${article.slug}`;
      await query(
        `UPDATE ghostwriter_posts SET status = 'published', published_at = NOW(),
         blog_url = $1, gbp_post_id = $2 WHERE id = $3`,
        [blogUrl, pubResult.gbpPostId || null, postId]
      );
    }

    return { postId, language, title: article.title, slug: article.slug, status: preview ? "draft" : "published" };
  } catch (err) {
    if (postId) {
      await query("UPDATE ghostwriter_posts SET status = 'failed', error_message = $1 WHERE id = $2", [err.message, postId]);
    }
    await logStep(tenantId, postId, "pipeline", "error", err.message, 0);
    return { postId, language, error: err.message, status: "failed" };
  }
}
