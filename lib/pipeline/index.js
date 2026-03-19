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
import { injectBacklink } from "./steps/backlink.js";
import { runResearch } from "./steps/research.js";
import { runAntiKitsch } from "./steps/antikitsch.js";
import { generateChart } from "./steps/chart.js";
import { runQA } from "./steps/qa.js";
import { runCorrector } from "./steps/corrector.js";

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

  // System-Config: globale Feature-Flags + Modell-Präferenzen + Pricing laden
  const { rows: sysRows } = await query("SELECT key, value FROM system_config WHERE key IN ('recommended_models', 'image_models', 'features', 'pricing')");
  const sysConfig = {};
  for (const r of sysRows) { try { sysConfig[r.key] = JSON.parse(r.value); } catch { sysConfig[r.key] = r.value; } }

  // Platform-Mode: Env-Keys verwenden statt Tenant-Keys
  if (decrypted.billing_mode === "platform") {
    decrypted.text_api_key = process.env.ANTHROPIC_API_KEY;
    decrypted.text_provider = "anthropic";
    if (process.env.OPENAI_API_KEY) {
      decrypted.image_api_key = process.env.OPENAI_API_KEY;
      decrypted.image_provider = "dalle3";
      decrypted.image_model = sysConfig.image_models?.openai?.model || "gpt-image-1";
    }
  } else if (!decrypted.image_model) {
    decrypted.image_model = sysConfig.image_models?.openai?.model || "gpt-image-1";
  }

  // Globale Features überschreiben tenant-spezifische Einstellungen
  decrypted.research_enabled = sysConfig.features?.research_enabled ?? decrypted.research_enabled ?? false;

  // Pricing zum Zeitpunkt der Erstellung festhalten (historischer Preis)
  const pricing = {
    post_price_cents: 300,
    backlink_price_cents: 100,
    membership_monthly_cents: 0,
    test_discount_percent: 60,
    ...sysConfig.pricing,
  };

  return { tenant, settings: decrypted, profile, topics, pricing };
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
  const { tenant, settings, profile, topics, pricing } = data;
  const tenantId = tenant.id;
  let postId = null;
  const pipelineStart = Date.now();

  try {
    // Step 1: PLANNER
    let start = Date.now();
    const plan = await runPlanner(topics, language, data._override, tenantId);
    await logStep(tenantId, null, "planner", "success", JSON.stringify(plan), Date.now() - start);

    // Step 2: SEO RESEARCHER
    start = Date.now();
    const seo = await runSeoResearch(settings, plan, profile, language);
    await logStep(tenantId, null, "seo", "success", `Keyword: ${seo.primaryKeyword}`, Date.now() - start);

    // Step 2b: RECHERCHE (optional, SearXNG/Tavily)
    let researchFacts = null;
    let referenceImageUrls = [];
    if (settings.research_enabled) {
      start = Date.now();
      researchFacts = await runResearch(settings, plan, seo);
      if (researchFacts) {
        const srcCount = researchFacts.sources?.length ?? 0;
        referenceImageUrls = researchFacts.referenceImageUrls || [];
        await logStep(tenantId, null, "research", "success", `${srcCount} Quellen recherchiert, ${referenceImageUrls.length} Ref-Bilder`, Date.now() - start);
      }
    }

    // Step 3: WRITER
    start = Date.now();
    const article = await runWriter(settings, plan, seo, profile, language, researchFacts);
    await logStep(tenantId, null, "writer", "success", `Title: ${article.title}`, Date.now() - start);

    // Check for duplicate slug
    const { rows: existing } = await query(
      "SELECT id FROM ghostwriter_posts WHERE tenant_id = $1 AND language = $2 AND blog_slug = $3",
      [tenantId, language, article.slug]
    );
    if (existing.length > 0) {
      article.slug = `${article.slug}-${Date.now().toString(36)}`;
    }

    // Step 3b: ANTI-KITSCH-PASS
    start = Date.now();
    article.body_html = await runAntiKitsch(settings, article.body_html);
    await logStep(tenantId, null, "antikitsch", "success", "Kitsch-Bereinigung", Date.now() - start);

    // Step 3c: BACKLINK-INJEKTION
    article.body_html = await injectBacklink(tenantId, settings, profile, article.body_html);

    // Step 4: IMAGE GENERATOR (2 Bilder: Blog + Artikel-Innenbild)
    start = Date.now();
    let imageResult = { url: null, localPath: null, url2: null, localPath2: null };
    try {
      imageResult = await runImageGen(settings, article, seo, plan, tenantId, referenceImageUrls);
      const src1 = imageResult.img1Source;
      const src2 = imageResult.img2Source;
      await logStep(tenantId, null, "image", "success", `img1=${src1}(${article.image_format_1||"landscape"}) img2=${src2}(${article.image_format_2||"landscape"})`, Date.now() - start);
    } catch (err) {
      await logStep(tenantId, null, "image", "error", err.message, Date.now() - start);
      // Continue without image
    }

    // Step 4b: CHART GENERATOR (optional, nur wenn Writer chart_config geliefert hat)
    if (article.chart_config) {
      start = Date.now();
      try {
        const chartResult = await generateChart(article.chart_config, article.slug);
        if (chartResult) {
          // <!-- CHART --> Platzhalter im body_html ersetzen
          if (article.body_html?.includes("<!-- CHART -->")) {
            article.body_html = article.body_html.replace(
              "<!-- CHART -->",
              `<figure class="article-figure"><img src="${chartResult.url}" alt="Diagramm: ${article.title}" loading="lazy" /></figure>`
            );
          } else {
            // Vor dem letzten <h2> einfügen
            const lastH2 = article.body_html?.lastIndexOf("<h2");
            if (lastH2 > 0) {
              article.body_html = article.body_html.slice(0, lastH2)
                + `<figure class="article-figure"><img src="${chartResult.url}" alt="Diagramm: ${article.title}" loading="lazy" /></figure>`
                + article.body_html.slice(lastH2);
            }
          }
          await logStep(tenantId, null, "chart", "success", `Chart generiert: ${chartResult.url}`, Date.now() - start);
        }
      } catch (err) {
        await logStep(tenantId, null, "chart", "error", err.message, Date.now() - start);
        // Kein Chart ist OK
      }
    }

    // Step 5b: QUALITY-CHECK
    start = Date.now();
    let qaResult = { score: null, issues: [], llmNote: null };
    try {
      qaResult = await runQA(article, seo, settings, sysConfig);
      const qaMsg = `Score: ${qaResult.score}/10 | Issues: ${qaResult.issues.length}${qaResult.llmNote ? ` | ${qaResult.llmNote.slice(0, 100)}` : ""}`;
      await logStep(tenantId, null, "qa", qaResult.score >= 8 ? "success" : "warning", qaMsg, Date.now() - start);
    } catch (err) {
      await logStep(tenantId, null, "qa", "error", err.message, Date.now() - start);
    }

    // Step 5c: KORREKTUR-BOT (nur bei gelb/rot — score < 8)
    if (qaResult.score !== null && qaResult.score < 8 && qaResult.issues.length > 0) {
      start = Date.now();
      try {
        const fixes = await runCorrector(article, seo, profile, qaResult.issues, settings);
        const fixCount = Object.keys(fixes).length;
        if (fixCount > 0) {
          Object.assign(article, fixes);
          // QA nochmal — finaler Score nach Korrektur
          qaResult = await runQA(article, seo, settings, sysConfig);
        }
        await logStep(
          tenantId, null, "corrector", "success",
          `${fixCount} Fix(es) → Score nach Korrektur: ${qaResult.score}/10`,
          Date.now() - start
        );
      } catch (err) {
        await logStep(tenantId, null, "corrector", "error", err.message, Date.now() - start);
      }
    }

    // Create post record
    const billingMode = settings.billing_mode || "own_key";
    // Preis zum Erstellungszeitpunkt festhalten (historisch — ändert sich nicht bei späterer Preiserhöhung)
    const isTest = data._isTest || false;
    const testDiscount = (pricing?.test_discount_percent ?? 60) / 100;
    const fullCostCents = billingMode === "platform" ? (pricing?.post_price_cents ?? 300) : 0;
    const costCents = billingMode === "platform"
      ? (isTest ? Math.round(fullCostCents * (1 - testDiscount)) : fullCostCents)
      : 0;

    const { rows: [post] } = await query(
      `INSERT INTO ghostwriter_posts
       (tenant_id, language, category, angle, season,
        blog_title, blog_slug, blog_body, blog_title_tag, blog_meta_description,
        blog_primary_keyword, image_url, image_alt_text, image_url_2, image_alt_text_2,
        gbp_text, status, is_test, billing_mode, cost_cents, full_cost_cents,
        qa_score, qa_issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        tenantId, language, plan.category, plan.angle, plan.season,
        article.title, article.slug, article.body_html,
        article.title_tag, article.meta_description,
        seo.primaryKeyword, imageResult.url,
        `${article.title} - ${seo.primaryKeyword}`,
        imageResult.url2,
        imageResult.url2 ? `${seo.primaryKeyword} - Google Business` : null,
        article.gbp_text,
        preview ? "draft" : "draft",
        isTest,
        billingMode,
        costCents,
        fullCostCents,
        qaResult.score,
        JSON.stringify(qaResult.issues),
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

    // Laufzeit speichern: gleitender Durchschnitt (70% alt + 30% neu)
    const totalMs = Date.now() - pipelineStart;
    const prevAvg = settings.avg_pipeline_ms;
    const newAvg = prevAvg ? Math.round(prevAvg * 0.7 + totalMs * 0.3) : totalMs;
    await query(
      "UPDATE tenant_settings SET avg_pipeline_ms = $1, last_pipeline_ms = $2 WHERE tenant_id = $3",
      [newAvg, totalMs, tenantId]
    );

    return { postId, language, title: article.title, slug: article.slug, status: preview ? "draft" : "published", durationMs: totalMs };
  } catch (err) {
    if (postId) {
      await query("UPDATE ghostwriter_posts SET status = 'failed', error_message = $1 WHERE id = $2", [err.message, postId]);
    }
    await logStep(tenantId, postId, "pipeline", "error", err.message, 0);
    return { postId, language, error: err.message, status: "failed" };
  }
}
