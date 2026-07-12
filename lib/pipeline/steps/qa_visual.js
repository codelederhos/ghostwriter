/**
 * Step: QA-VISUAL (Headless-Render + Vision-Check)
 * Läuft nach dem Publisher. Holt die Live-URL via Browserless, screenshottet
 * sie und prüft mit Claude-Vision auf typische Layout-Bugs.
 * Findings landen in ghostwriter_posts.qa_visual + qa_screenshot_url.
 * Bei "issues_found" wird zusätzlich eine Telegram-Notif an die Tenant-
 * Chat-ID geschickt (Fallback: stani 8591743701 wenn keine konfiguriert).
 */

import { query } from "../../db.js";
import fs from "node:fs/promises";
import path from "node:path";

const BROWSERLESS_URL = process.env.BROWSERLESS_URL || "http://browserless:3000";
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "ghostwriter-qa-internal";
const VISION_MODEL = process.env.QA_VISION_MODEL || "claude-haiku-4-5";
const VISION_FALLBACK_MODEL = "claude-haiku-4-5";
const SCREENSHOT_DIR = "/app/public/uploads/qa";
const TELEGRAM_FALLBACK_CHAT = "8591743701";

const CHECK_PROMPT = `Du bist visueller QA-Reviewer für einen veröffentlichten Blog-Artikel.
Analysiere das beigefügte Screenshot der Live-Seite und prüfe konkret:
1. Tipp/Info/Warning-Callouts: Text horizontal aufgespalten oder in Spalten/mit "|"-Separatoren? Icon korrekt links?
2. Charts/Grafiken sichtbar gerendert (nicht leer, keine 404, keine Fehler-Box)?
3. Tabellen: passen in Viewport (nicht überlaufend)?
4. Bilder geladen (kein alt-text-only, kein broken-image-icon)?
5. Genau eine Haupt-Navigation, genau ein Footer (keine Duplikate)?
6. CTA-Buttons sichtbar und ansprechbar?
7. Layout-Bugs: Overflow horizontal, überlappende Texte, abgeschnittene Karten?

Antworte AUSSCHLIESSLICH mit gültigem JSON in diesem Schema:
{
  "ok": true|false,
  "score": 0-100,
  "issues": [
    {"area": "callout|chart|table|image|nav|footer|cta|layout", "severity": "low|medium|high", "description": "kurz, konkret"}
  ],
  "summary": "1 Satz Gesamteindruck"
}
Wenn alles sauber: ok=true, score>=85, issues=[].`;

async function takeScreenshot(url) {
  const res = await fetch(`${BROWSERLESS_URL}/screenshot?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      options: { type: "png", fullPage: false },
      viewport: { width: 1280, height: 1800, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
      waitForTimeout: 1500
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`browserless ${res.status}: ${txt.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function callClaudeVision(pngBuffer) {
  const oauth = process.env.CLAUDE_OAUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!oauth && !apiKey) throw new Error("CLAUDE_OAUTH_TOKEN or ANTHROPIC_API_KEY required");
  const headers = {
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json"
  };
  if (oauth) {
    headers["Authorization"] = `Bearer ${oauth}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }
  const b64 = pngBuffer.toString("base64");
  const buildBody = (model) => JSON.stringify({
    model,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        { type: "text", text: CHECK_PROMPT }
      ]
    }]
  });
  let res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers, body: buildBody(VISION_MODEL)
  });
  if (!res.ok && (res.status === 429 || res.status === 529) && VISION_MODEL !== VISION_FALLBACK_MODEL) {
    console.warn(`[qa_visual] ${res.status} bei ${VISION_MODEL}, Fallback auf ${VISION_FALLBACK_MODEL}`);
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, body: buildBody(VISION_FALLBACK_MODEL)
    });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json in vision response");
  return JSON.parse(match[0]);
}

async function notifyTelegram(settings, postId, tenant, blogUrl, findings, screenshotUrl) {
  const token = settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegram_chat_id || TELEGRAM_FALLBACK_CHAT;
  if (!token || !chatId) return;
  const issues = (findings.issues || []).slice(0, 6).map(
    i => `• [${i.severity}] ${i.area}: ${i.description}`
  ).join("\n");
  const text = [
    `*Ghostwriter QA-Visual*`,
    `Tenant: ${tenant?.name || tenant?.slug || "?"}`,
    `Post: ${postId}`,
    `URL: ${blogUrl}`,
    `Score: ${findings.score ?? "?"}`,
    findings.summary ? `Summary: ${findings.summary}` : null,
    issues ? `\nIssues:\n${issues}` : null,
    screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : null
  ].filter(Boolean).join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: false })
    });
  } catch (err) {
    console.error("[qa_visual] telegram error:", err.message);
  }
}

async function saveScreenshot(pngBuffer, postId) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const fname = `post-${postId}-${Date.now()}.png`;
  const abs = path.join(SCREENSHOT_DIR, fname);
  await fs.writeFile(abs, pngBuffer);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  return { abs, url: `${base}/uploads/qa/${fname}` };
}

export async function runQaVisual({ tenant, settings, post, blogUrl }) {
  const start = Date.now();
  try {
    // Webhook-Sync abwarten
    await new Promise(r => setTimeout(r, 2000));

    const png = await takeScreenshot(blogUrl);
    const { url: screenshotUrl } = await saveScreenshot(png, post.id);
    const findings = await callClaudeVision(png);
    findings.checked_at = new Date().toISOString();
    findings.duration_ms = Date.now() - start;
    findings.model = VISION_MODEL;

    await query(
      "UPDATE ghostwriter_posts SET qa_visual = $1, qa_screenshot_url = $2 WHERE id = $3",
      [JSON.stringify(findings), screenshotUrl, post.id]
    );

    const hasHigh = (findings.issues || []).some(i => i.severity === "high");
    const lowScore = typeof findings.score === "number" && findings.score < 80;
    if (!findings.ok || hasHigh || lowScore) {
      await notifyTelegram(settings, post.id, tenant, blogUrl, findings, screenshotUrl);
    }

    return { ok: true, findings, screenshotUrl };
  } catch (err) {
    console.error("[qa_visual] error:", err.message);
    const payload = { ok: false, error: err.message, checked_at: new Date().toISOString() };
    try {
      await query("UPDATE ghostwriter_posts SET qa_visual = $1 WHERE id = $2", [JSON.stringify(payload), post.id]);
    } catch {}
    return { ok: false, error: err.message };
  }
}
