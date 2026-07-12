#!/usr/bin/env node
/**
 * Bulk-Vision-Beschreibung für tenant_reference_images.
 * Primaer: OC qwen3-vl:235b-cloud (OpenAI-kompat) ueber openclaw-ollama.
 * Fallback nach 3 aufeinanderfolgenden Fails: Anthropic Haiku (OAuth).
 *
 * Liest Bilder mit description<30 zeichen ODER weniger als 2 categories,
 * sendet base64 an Vision-Modell, parst JSON, schreibt UPDATE.
 *
 * Idempotent. Rate-Limit 1 Bild/2s. Concurrency 3.
 */

const { Client } = require("pg");
const fs = require("node:fs");

const OC_URL = process.env.OC_VISION_URL || "http://openclaw-ollama:11434/v1/chat/completions";
const OC_MODEL = process.env.OC_VISION_MODEL || "qwen3-vl:235b-cloud";
const OC_KEY = process.env.OC_VISION_KEY || "ollama";

const HAIKU_MODEL = "claude-haiku-4-5";
const ANTHROPIC_OAUTH = process.env.CLAUDE_OAUTH_TOKEN || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de";
const TENANT_FILTER = process.env.TENANT_ID || ""; // optional

const RATE_DELAY_MS = 2000;
const CONCURRENCY = 3;
const FAIL_SWITCH_THRESHOLD = 3;

const SYSTEM_PROMPT = "Du bist Bild-Redakteur für einen Immobilien-Blog. Beschreibe das Bild präzise auf Deutsch, idiomatisch. Antworte ausschliesslich als JSON: {\"description\":\"...\",\"categories\":[\"...\",\"...\"],\"room_type\":\"...\",\"mood\":\"...\"}. description min 60 zeichen, categories 2-6 stueck deutsch.";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let consecutiveOcFails = 0;
let useFallback = false;

function imageToUrl(image_url) {
  if (image_url.startsWith("http")) return image_url;
  // local volume path served by app
  if (image_url.startsWith("/uploads/")) {
    // Try container-local file first
    const localPath = "/app/public" + image_url;
    if (fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      const ext = image_url.split(".").pop().toLowerCase();
      const mime = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return { kind: "local", buf, mime };
    }
    return PUBLIC_BASE + image_url;
  }
  return image_url;
}

async function fetchImageBuffer(image_url) {
  const resolved = imageToUrl(image_url);
  if (typeof resolved === "object" && resolved.kind === "local") {
    return { buf: resolved.buf, mime: resolved.mime };
  }
  const res = await fetch(resolved, { method: "GET" });
  if (!res.ok) throw new Error(`fetch image ${res.status} ${resolved}`);
  const ct = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, mime: ct.split(";")[0] };
}

async function callOcVision(buf, mime) {
  const b64 = buf.toString("base64");
  const body = {
    model: OC_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analysiere das Bild und antworte als JSON wie spezifiziert." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        ]
      }
    ],
    temperature: 0.2,
    max_tokens: 600
  };
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(OC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OC_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`oc ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return text;
  } finally {
    clearTimeout(tm);
  }
}

async function callHaikuVision(buf, mime) {
  if (!ANTHROPIC_OAUTH && !ANTHROPIC_KEY) throw new Error("no anthropic credentials");
  const b64 = buf.toString("base64");
  const media = mime === "image/webp" ? "image/webp" : mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const headers = { "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
  if (ANTHROPIC_OAUTH) {
    headers["Authorization"] = `Bearer ${ANTHROPIC_OAUTH}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = ANTHROPIC_KEY;
  }
  const body = JSON.stringify({
    model: HAIKU_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: media, data: b64 } },
        { type: "text", text: "Analysiere das Bild und antworte als JSON wie spezifiziert." }
      ]
    }]
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body });
  if (!res.ok) throw new Error(`haiku ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.content?.[0]?.text || "";
}

function parseVisionJson(raw) {
  if (!raw) throw new Error("empty vision response");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json in vision output");
  const obj = JSON.parse(match[0]);
  if (!obj.description || typeof obj.description !== "string") throw new Error("missing description");
  if (!Array.isArray(obj.categories) || obj.categories.length < 2) {
    obj.categories = obj.categories && Array.isArray(obj.categories) ? obj.categories : [];
    if (obj.categories.length < 2) obj.categories.push("Immobilie", "Architektur");
  }
  obj.categories = obj.categories.map(c => String(c).trim()).filter(Boolean).slice(0, 6);
  obj.room_type = obj.room_type ? String(obj.room_type).trim() : null;
  obj.mood = obj.mood ? String(obj.mood).trim() : null;
  return obj;
}

async function analyzeOne(client, row, idx, total) {
  const prefix = `[${idx + 1}/${total}] ${row.id.slice(0, 8)}`;
  try {
    const { buf, mime } = await fetchImageBuffer(row.image_url);
    let raw;
    if (useFallback) {
      raw = await callHaikuVision(buf, mime);
    } else {
      try {
        raw = await callOcVision(buf, mime);
        consecutiveOcFails = 0;
      } catch (e) {
        consecutiveOcFails++;
        console.warn(`${prefix} OC fail ${consecutiveOcFails}/${FAIL_SWITCH_THRESHOLD}: ${e.message}`);
        if (consecutiveOcFails >= FAIL_SWITCH_THRESHOLD) {
          console.warn(`${prefix} Switching to Haiku fallback`);
          useFallback = true;
        }
        raw = await callHaikuVision(buf, mime);
      }
    }
    const parsed = parseVisionJson(raw);
    await client.query(
      `UPDATE tenant_reference_images
       SET description = $1,
           categories = $2,
           room_type = COALESCE(NULLIF($3,''), room_type),
           auto_description = true,
           ai_analyzed = true
       WHERE id = $4`,
      [parsed.description, parsed.categories, parsed.room_type || "", row.id]
    );
    return { ok: true, id: row.id, description: parsed.description.slice(0, 120), categories: parsed.categories, room_type: parsed.room_type };
  } catch (e) {
    console.warn(`${prefix} SKIP: ${e.message}`);
    return { ok: false, id: row.id, error: e.message };
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL missing");
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const params = [];
  let where = `(description IS NULL OR LENGTH(TRIM(description)) < 30
                OR categories IS NULL OR array_length(categories,1) < 2)`;
  if (TENANT_FILTER) {
    params.push(TENANT_FILTER);
    where += ` AND tenant_id = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT id, type, image_url FROM tenant_reference_images WHERE ${where} ORDER BY created_at ASC`,
    params
  );
  console.log(`[analyze-references] candidates=${rows.length} tenant=${TENANT_FILTER || "ALL"} model=${OC_MODEL}`);
  if (rows.length === 0) {
    await client.end();
    console.log("[analyze-references] nothing to do");
    return;
  }

  const results = [];
  let nextIdx = 0;
  let active = 0;
  const total = rows.length;

  await new Promise((resolve) => {
    const tick = async () => {
      while (active < CONCURRENCY && nextIdx < total) {
        const myIdx = nextIdx++;
        active++;
        analyzeOne(client, rows[myIdx], myIdx, total)
          .then(r => results.push(r))
          .catch(e => results.push({ ok: false, id: rows[myIdx].id, error: e.message }))
          .finally(() => {
            active--;
            if (results.length === total) return resolve();
            if (results.length % 20 === 0) {
              const ok = results.filter(r => r.ok).length;
              console.log(`[analyze-references] progress ${results.length}/${total} ok=${ok}`);
            }
            setTimeout(tick, RATE_DELAY_MS);
          });
      }
    };
    tick();
  });

  await client.end();
  const ok = results.filter(r => r.ok);
  console.log(`[analyze-references] DONE total=${total} ok=${ok.length} fail=${total - ok.length}`);
  console.log("[analyze-references] samples:");
  ok.slice(0, 3).forEach(r => console.log(JSON.stringify(r, null, 2)));
}

main().catch(e => { console.error("FATAL", e); process.exit(1); });
