/**
 * Post-Publish Visual-QA gegen die tatsächlich veröffentlichte Zielseite.
 * Prüft Desktop und Mobile vollständig, lädt Lazy-Medien durch Scrollen und
 * kombiniert deterministische DOM-Metriken mit einem visuellen Review.
 */

import sharp from "sharp";
import { query } from "../../db.js";
import { callClaudeVision } from "../vision.js";

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || "http://browserless:3000";
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "ghostwriter-qa";
const TELEGRAM_FALLBACK_CHAT = "8591743701";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "mobile", width: 390, height: 844 },
];

const CHECK_PROMPT = `Du bist visueller QA-Reviewer für einen veröffentlichten Unternehmensblog.
Du siehst dieselbe vollständige Live-Seite auf Desktop und Mobile.

Prüfe konkret:
1. zweites Artikelbild und Diagramm behalten ihr natürliches Seitenverhältnis
2. Diagramm ist auf Desktop klar gestaltet, gut lesbar, nicht leer und nicht künstlich aufgeblasen
3. Tabellen und Karten passen in den Viewport
4. alle Bilder sind geladen und sinnvoll in den Lesefluss integriert
5. Navigation und Footer erscheinen nicht doppelt
6. CTAs sind sichtbar, verständlich und nicht überlagert
7. kein horizontaler Overflow, abgeschnittener Text oder überlappende Elemente
8. Desktop wirkt ebenso hochwertig wie Mobile

Antworte ausschließlich mit gültigem JSON:
{
  "ok": true,
  "score": 0,
  "issues": [
    {
      "viewport": "desktop|mobile|both",
      "area": "chart|table|image|nav|footer|cta|layout",
      "severity": "low|medium|high",
      "description": "kurz und konkret"
    }
  ],
  "summary": "ein Satz"
}

ok darf nur true sein, wenn score mindestens 85 ist und kein high-Problem besteht.`;

const BROWSER_AUDIT_FUNCTION = `export default async ({ page, context }) => {
  const { url, width, height } = context;
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
  await page.evaluate(async () => {
    const max = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    for (let y = 0; y < max; y += Math.max(320, Math.floor(window.innerHeight * 0.72))) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const naturalWidth = Number(element.naturalWidth || 0);
      const naturalHeight = Number(element.naturalHeight || 0);
      const renderedRatio = rect.height > 0 ? rect.width / rect.height : 0;
      const naturalRatio = naturalHeight > 0 ? naturalWidth / naturalHeight : 0;
      const ratioDelta = naturalRatio > 0 && renderedRatio > 0
        ? Math.abs(renderedRatio - naturalRatio) / naturalRatio
        : null;
      return {
        src: element.currentSrc || element.src || "",
        naturalWidth,
        naturalHeight,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
        ratioDelta,
      };
    };
    const articleRoot = document.querySelector(".blog-prose,.blog-article-body,article .body,article .content,article") || body;
    const images = [...articleRoot.querySelectorAll("img")].map(describe);
    const charts = [...articleRoot.querySelectorAll(".gw-chart img,.gw-chart canvas")].map((element) => {
      const rect = element.getBoundingClientRect();
      return element.tagName === "IMG"
        ? describe(element)
        : { renderedWidth: Math.round(rect.width), renderedHeight: Math.round(rect.height), ratioDelta: null };
    });
    return {
      title: document.title,
      url: location.href,
      viewportWidth: window.innerWidth,
      documentWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
      horizontalOverflowPx: Math.max(0, Math.max(doc.scrollWidth, body?.scrollWidth || 0) - window.innerWidth),
      navigationCount: document.querySelectorAll("header,nav[aria-label='Hauptnavigation'],nav[aria-label='Main navigation']").length,
      footerCount: document.querySelectorAll("footer").length,
      images,
      charts,
      brokenImages: images.filter((image) => image.naturalWidth === 0).map((image) => image.src),
    };
  });
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  return {
    data: { metrics, screenshot: screenshot.toString("base64") },
    type: "application/json",
  };
};`;

async function runBrowserAudit(url, viewport) {
  const response = await fetch(`${BROWSERLESS_URL}/function?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: BROWSER_AUDIT_FUNCTION,
      context: { url, width: viewport.width, height: viewport.height },
    }),
    signal: AbortSignal.timeout(35000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`browserless ${response.status}: ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  const result = payload?.data?.metrics ? payload.data : payload;
  if (!result?.metrics || !result?.screenshot) throw new Error("browserless response incomplete");
  return {
    viewport,
    metrics: result.metrics,
    screenshot: Buffer.from(result.screenshot, "base64"),
  };
}

export async function prepareVisionImages(buffer, viewport) {
  const metadata = await sharp(buffer).metadata();
  const width = Number(metadata.width || viewport.width);
  const height = Number(metadata.height || viewport.height);
  const overview = await sharp(buffer)
    .resize({ width: 1200, height: 6500, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 8 })
    .toBuffer();
  const images = [{
    label: `${viewport.name} ${viewport.width}x${viewport.height}, Seitenübersicht`,
    buffer: overview,
    mediaType: "image/png",
  }];

  const tileHeight = viewport.name === "mobile" ? 1400 : 1800;
  const tileCount = Math.min(4, Math.max(1, Math.ceil(height / tileHeight)));
  const maxTop = Math.max(0, height - Math.min(tileHeight, height));
  const starts = [...new Set(
    Array.from({ length: tileCount }, (_, index) =>
      tileCount === 1 ? 0 : Math.round((maxTop * index) / (tileCount - 1))
    )
  )];

  for (const [index, top] of starts.entries()) {
    const cropHeight = Math.min(tileHeight, height - top);
    const tile = await sharp(buffer)
      .extract({ left: 0, top, width, height: cropHeight })
      .resize({ width: viewport.name === "mobile" ? 1170 : 1440, withoutEnlargement: false })
      .png({ compressionLevel: 8 })
      .toBuffer();
    images.push({
      label: `${viewport.name} lesbarer Ausschnitt ${index + 1}/${starts.length}`,
      buffer: tile,
      mediaType: "image/png",
    });
  }
  return images;
}

function structuralIssues(audits) {
  const issues = [];
  for (const audit of audits) {
    const viewport = audit.viewport.name;
    const metrics = audit.metrics;
    if (metrics.horizontalOverflowPx > 2) {
      issues.push({
        viewport,
        area: "layout",
        severity: "high",
        description: `${metrics.horizontalOverflowPx}px horizontaler Overflow bei ${metrics.viewportWidth}px Viewport.`,
      });
    }
    if ((metrics.brokenImages || []).length) {
      issues.push({
        viewport,
        area: "image",
        severity: "high",
        description: `${metrics.brokenImages.length} Bild(er) sind nicht geladen.`,
      });
    }
    const distorted = (metrics.images || []).filter((image) => Number(image.ratioDelta) > 0.08);
    if (distorted.length) {
      const worst = distorted.sort((a, b) => b.ratioDelta - a.ratioDelta)[0];
      issues.push({
        viewport,
        area: "image",
        severity: "high",
        description: `${distorted.length} Bild(er) verzerrt, stärkste Abweichung ${Math.round(worst.ratioDelta * 100)}%.`,
      });
    }
    if ((metrics.charts || []).some((chart) => Number(chart.renderedWidth) < 240 || Number(chart.renderedHeight) < 140)) {
      issues.push({
        viewport,
        area: "chart",
        severity: "medium",
        description: "Mindestens ein Diagramm ist zu klein für eine belastbare Lesbarkeit.",
      });
    }
    if (metrics.footerCount !== 1) {
      issues.push({
        viewport,
        area: "footer",
        severity: "medium",
        description: `Erwartet ist genau ein Footer, gefunden wurden ${metrics.footerCount}.`,
      });
    }
  }
  return issues;
}

async function notifyTelegram(settings, postId, tenant, blogUrl, findings) {
  const token = settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegram_chat_id || TELEGRAM_FALLBACK_CHAT;
  if (!token || !chatId) return;
  const issues = (findings.issues || []).slice(0, 8).map(
    (issue) => `• [${issue.severity}] ${issue.viewport || "?"}/${issue.area}: ${issue.description}`
  ).join("\n");
  const text = [
    "*Ghostwriter QA-Visual*",
    `Tenant: ${tenant?.name || tenant?.slug || "?"}`,
    `Post: ${postId}`,
    `URL: ${blogUrl}`,
    `Score: ${findings.score ?? "?"}`,
    findings.summary ? `Summary: ${findings.summary}` : null,
    issues ? `\nIssues:\n${issues}` : null,
  ].filter(Boolean).join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    console.error("[qa_visual] telegram error:", error.message);
  }
}

export async function runQaVisual({ tenant, settings, post, blogUrl }) {
  const start = Date.now();
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const audits = await Promise.all(VIEWPORTS.map((viewport) => runBrowserAudit(blogUrl, viewport)));

    const visionImages = (await Promise.all(
      audits.map((audit) => prepareVisionImages(audit.screenshot, audit.viewport))
    )).flat();
    const { result: vision, model } = await callClaudeVision({
      images: visionImages,
      prompt: CHECK_PROMPT,
      maxTokens: 1600,
    });

    const deterministic = structuralIssues(audits);
    const visualIssues = Array.isArray(vision?.issues) ? vision.issues : [];
    const issues = [...deterministic, ...visualIssues];
    const highCount = issues.filter((issue) => issue?.severity === "high").length;
    const mediumCount = issues.filter((issue) => issue?.severity === "medium").length;
    const visualScore = Number(vision?.score) || 0;
    const score = Math.max(0, Math.min(100, visualScore - highCount * 15 - mediumCount * 5));
    const findings = {
      ...vision,
      ok: vision?.ok === true && score >= 85 && highCount === 0,
      score,
      issues,
      viewports: Object.fromEntries(audits.map((audit) => [audit.viewport.name, audit.metrics])),
      screenshot_storage: "ephemeral",
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - start,
      model,
    };

    await query(
      "UPDATE ghostwriter_posts SET qa_visual = $1, qa_screenshot_url = $2 WHERE id = $3",
      [JSON.stringify(findings), null, post.id]
    );

    if (!findings.ok) {
      await notifyTelegram(settings, post.id, tenant, blogUrl, findings);
    }
    return { ok: findings.ok, executed: true, findings };
  } catch (error) {
    console.error("[qa_visual] error:", error.message);
    const payload = { ok: false, error: error.message, checked_at: new Date().toISOString() };
    try {
      await query("UPDATE ghostwriter_posts SET qa_visual = $1 WHERE id = $2", [JSON.stringify(payload), post.id]);
    } catch {}
    return { ok: false, executed: false, error: error.message };
  }
}
