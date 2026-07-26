import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const UPLOAD_DIR = process.env.GHOSTWRITER_UPLOAD_DIR || "/app/public/uploads/ai-gen";
// Container-Mount: /app/secrets:ro (siehe docker-compose.yml)
const SECRETS_DIR = process.env.SECRETS_DIR || "/app/secrets";

/**
 * POST /api/tenants/[id]/images/generate
 *
 * Body (JSON):
 *   {
 *     prompt: string (Pflicht, min 10 Zeichen),
 *     mode: "new" | "edit",
 *     source_image_url?: string (Pflicht bei mode=edit, absolute oder /uploads/...),
 *     post_id?: string (wenn gesetzt: blog-Eintrag im Ghostwriter aktualisieren — hier nicht genutzt,
 *                       baurimmo-Proxy macht das in seiner DB. Wird durchgereicht falls Tenant=Ghostwriter-Owned).
 *     attach_collection?: boolean (default true — Insert in tenant_reference_images)
 *   }
 *
 * Auth:
 *   - Cookie-Session (Admin) ODER Bearer-Token GHOSTWRITER_ADMIN_TOKEN
 *
 * Flow:
 *   1. Provider-Wahl: Cloudflare-Flux (mode=new), fal.ai Flux Kontext Pro (mode=edit),
 *      Auto-Fallback Cloudflare→fal bei Auth-/Server-Fehler.
 *   2. PNG/JPG-Bytes → sharp → 1200px-WebP unter /public/uploads/ai-gen/<uuid>.webp.
 *   3. INSERT in tenant_reference_images (type=post, approval_status=approved,
 *      auto_description=false, description="KI-generiert: {prompt}").
 *   4. Response: { ok, image_url (absolut), thumb_url, collection_image_id, provider }
 */
async function isAuthed(req) {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const expected = process.env.GHOSTWRITER_ADMIN_TOKEN || "";
  if (bearer && expected && bearer === expected) {
    return { id: "bearer", role: "admin", email: "bearer@server" };
  }
  return await requireAdmin();
}

async function readSecret(envVar, fileName) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const p = path.join(/* turbopackIgnore: true */ SECRETS_DIR, fileName);
  try {
    const txt = await readFile(/* turbopackIgnore: true */ p, "utf8");
    return txt.trim();
  } catch {
    return null;
  }
}

/* ---------- Cloudflare Workers AI Flux-Schnell ---------- */
async function generateCloudflareFlux(prompt) {
  const token = await readSecret("CLOUDFLARE_API_TOKEN", "cloudflare_api_token");
  const accountId = await readSecret("CLOUDFLARE_ACCOUNT_ID", "cloudflare_account_id");
  if (!token || !accountId) {
    const err = new Error("cloudflare_credentials_missing");
    err.code = "CLOUDFLARE_NOT_CONFIGURED";
    throw err;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(60_000),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`cloudflare_${res.status}: ${body.slice(0, 200)}`);
    err.code = res.status === 401 || res.status === 403 ? "CLOUDFLARE_AUTH" : "CLOUDFLARE_ERROR";
    throw err;
  }
  // Cloudflare liefert seit Update JSON {result:{image:"<base64>"}} ODER image/* binary.
  if (ct.includes("application/json")) {
    const j = await res.json();
    const b64 = j?.result?.image;
    if (!b64) throw new Error("cloudflare_no_image_in_json");
    return Buffer.from(b64, "base64");
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- fal.ai Flux Schnell (Text-to-Image) ---------- */
async function generateFalFluxSchnell(prompt) {
  const key = await readSecret("FAL_API_KEY", "fal_api_key");
  if (!key) {
    const err = new Error("fal_credentials_missing");
    err.code = "FAL_NOT_CONFIGURED";
    throw err;
  }
  const submit = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size: { width: 1200, height: 900 },
      num_images: 1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    const txt = await submit.text().catch(() => "");
    throw new Error(`fal_submit_${submit.status}: ${txt.slice(0, 200)}`);
  }
  const job = await submit.json();
  const statusUrl = job.status_url;
  const responseUrl = job.response_url;
  if (!statusUrl) throw new Error("fal_no_status_url");
  return await pollFal(statusUrl, responseUrl, key);
}

/* ---------- fal.ai Flux Kontext Pro (Image-to-Image) ---------- */
async function generateFalKontext(prompt, sourceImageUrl) {
  const key = await readSecret("FAL_API_KEY", "fal_api_key");
  if (!key) {
    const err = new Error("fal_credentials_missing");
    err.code = "FAL_NOT_CONFIGURED";
    throw err;
  }
  const submit = await fetch("https://queue.fal.run/fal-ai/flux-pro/kontext", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_url: sourceImageUrl }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    const txt = await submit.text().catch(() => "");
    throw new Error(`fal_kontext_submit_${submit.status}: ${txt.slice(0, 200)}`);
  }
  const job = await submit.json();
  return await pollFal(job.status_url, job.response_url, key);
}

async function pollFal(statusUrl, responseUrl, key) {
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    if (!s.ok) continue;
    const sj = await s.json();
    if (sj.status === "COMPLETED" || sj.images || sj.image) break;
    if (sj.status === "FAILED") throw new Error(`fal_failed: ${JSON.stringify(sj).slice(0, 300)}`);
  }
  const r = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!r.ok) throw new Error(`fal_response_${r.status}`);
  const data = await r.json();
  const imgUrl = data?.images?.[0]?.url;
  if (!imgUrl) throw new Error("fal_no_image_url");
  const ir = await fetch(imgUrl, { signal: AbortSignal.timeout(30_000) });
  if (!ir.ok) throw new Error(`fal_image_download_${ir.status}`);
  return Buffer.from(await ir.arrayBuffer());
}

/* ---------- Source-URL nach absoluter URL aufloesen (fuer fal Kontext) ---------- */
function resolveAbsoluteUrl(req, raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseFromEnv = process.env.GHOSTWRITER_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (baseFromEnv) return `${baseFromEnv.replace(/\/+$/, "")}${raw.startsWith("/") ? "" : "/"}${raw}`;
  // Fallback: aus Request-Header
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return raw;
  return `${proto}://${host}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function addUrlHost(hosts, value) {
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.hostname) hosts.add(parsed.hostname.toLowerCase());
  } catch { /* ignore */ }
}

async function allowedSourceImageUrl(req, raw, tenantId) {
  const absolute = resolveAbsoluteUrl(req, raw);
  if (!absolute) return null;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const hosts = new Set();
  addUrlHost(hosts, process.env.GHOSTWRITER_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL);
  addUrlHost(hosts, `https://${req.headers.get("x-forwarded-host") || req.headers.get("host") || ""}`);
  try {
    const { rows } = await query(
      "SELECT client_api_url FROM tenant_settings WHERE tenant_id = $1 LIMIT 1",
      [tenantId]
    );
    addUrlHost(hosts, rows[0]?.client_api_url);
  } catch { /* fail closed below */ }

  return hosts.has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
}

/* ---------- Hauptroute ---------- */
export async function POST(req, props) {
  const params = await props.params;
  const session = await isAuthed(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenantId } = params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const prompt = (body.prompt || "").toString().trim();
  const mode = body.mode === "edit" ? "edit" : "new";
  const sourceRaw = body.source_image_url ? body.source_image_url.toString().trim() : "";
  const attachCollection = body.attach_collection !== false;

  if (prompt.length < 10) {
    return NextResponse.json({ error: "prompt_too_short", min: 10 }, { status: 400 });
  }
  if (mode === "edit" && !sourceRaw) {
    return NextResponse.json({ error: "source_image_url required for mode=edit" }, { status: 400 });
  }

  // Provider-Routing
  let imageBuffer;
  let provider;
  let providerNote = null;
  try {
    if (mode === "edit") {
      const absSource = await allowedSourceImageUrl(req, sourceRaw, tenantId);
      if (!absSource) {
        return NextResponse.json({ error: "source_image_not_allowed" }, { status: 400 });
      }
      imageBuffer = await generateFalKontext(prompt, absSource);
      provider = "fal-flux-kontext-pro";
    } else {
      // mode=new — erst Cloudflare-Flux (Stani-Wunsch), Fallback fal.ai
      try {
        imageBuffer = await generateCloudflareFlux(prompt);
        provider = "cloudflare-flux-1-schnell";
      } catch (e) {
        if (e.code === "CLOUDFLARE_AUTH" || e.code === "CLOUDFLARE_NOT_CONFIGURED") {
          providerNote = `Cloudflare nicht verfuegbar (${e.code}), Fallback fal.ai`;
          imageBuffer = await generateFalFluxSchnell(prompt);
          provider = "fal-flux-schnell-fallback";
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: "generate_failed", detail: e.message || String(e), provider_note: providerNote },
      { status: 502 }
    );
  }

  // Speichern als WebP (1200px Full + 400px Thumb)
  await mkdir(UPLOAD_DIR, { recursive: true });
  const baseName = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const fullPath = path.join(UPLOAD_DIR, `${baseName}.webp`);
  const thumbPath = path.join(UPLOAD_DIR, `${baseName}-thumb.webp`);

  try {
    await sharp(imageBuffer)
      .resize(1200, null, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(fullPath);
    await sharp(imageBuffer)
      .resize(400, null, { withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(thumbPath);
  } catch (e) {
    return NextResponse.json({ error: "sharp_failed", detail: e.message }, { status: 500 });
  }

  const imageUrl = `/uploads/ai-gen/${baseName}.webp`;
  const thumbUrl = `/uploads/ai-gen/${baseName}-thumb.webp`;

  // Insert in tenant_reference_images
  let collectionImageId = null;
  if (attachCollection) {
    try {
      const desc = `KI-generiert: ${prompt.slice(0, 220)}`;
      const { rows: [img] } = await query(
        `INSERT INTO tenant_reference_images
           (tenant_id, type, image_url, thumb_url, description, approval_status, auto_description)
         VALUES ($1, 'post', $2, $3, $4, 'approved', false)
         RETURNING id`,
        [tenantId, imageUrl, thumbUrl, desc]
      );
      collectionImageId = img?.id || null;
    } catch (e) {
      // Spalte auto_description existiert eventuell nicht — Retry ohne
      try {
        const desc = `KI-generiert: ${prompt.slice(0, 220)}`;
        const { rows: [img] } = await query(
          `INSERT INTO tenant_reference_images
             (tenant_id, type, image_url, thumb_url, description, approval_status)
           VALUES ($1, 'post', $2, $3, $4, 'approved')
           RETURNING id`,
          [tenantId, imageUrl, thumbUrl, desc]
        );
        collectionImageId = img?.id || null;
      } catch (e2) {
        // Collection-Insert ist optional
        console.warn("[ai-gen] collection insert failed:", e2.message);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    image_url: imageUrl,
    thumb_url: thumbUrl,
    collection_image_id: collectionImageId,
    provider,
    provider_note: providerNote,
    mode,
  });
}
