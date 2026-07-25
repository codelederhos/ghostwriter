import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { findPostByReviewToken } from "@/lib/review/publish";
import { generateImage, findWebReferences } from "@/lib/providers/image.js";
import { syncReviewDraftToClient } from "@/lib/pipeline/steps/publisher.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Bild-Generierung auf dem Mac dauert Minuten

const BASE_URL = () => process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de";

const DEFAULT_STYLE = "Bright airy premium editorial photograph, photorealistic, high-end magazine quality. Modern elegant setting, soft natural daylight, light neutral tones with warm accents, friendly optimistic mood. Any people have a Central European appearance, captured candidly, never looking at the camera. No text, no logos, no dark moody lighting, no rustic boho props";

async function loadSettings(tenantId) {
  const { rows: [settings] } = await query("SELECT * FROM tenant_settings WHERE tenant_id = $1", [tenantId]);
  if (!settings) return null;
  const decrypted = { ...settings };
  for (const f of ["image_api_key", "text_api_key"]) {
    if (decrypted[f]) try { decrypted[f] = decrypt(decrypted[f]); } catch { /* ok */ }
  }
  if (decrypted.billing_mode === "platform") {
    // dalle3 nur als Fallback — imgstudio/stock des Tenants nie überschreiben
    if (process.env.OPENAI_API_KEY && (!decrypted.image_provider || decrypted.image_provider === "dalle3")) {
      decrypted.image_api_key = process.env.OPENAI_API_KEY;
      decrypted.image_provider = "dalle3";
    }
  }
  return decrypted;
}

function syncClientCopy(postId) {
  syncReviewDraftToClient(postId).catch((err) =>
    console.error("[image-update] Client-Draft-Sync:", err?.message || err)
  );
}

/** Bild in Post + (bei Bild 2) Body-Figure übernehmen */
async function applyImage(post, which, url) {
  if (which === "2") {
    let body = post.blog_body || "";
    const m = body.match(/article-figure[^>]*><img src="([^"]+)"/);
    if (m && m[1] !== url) body = body.split(m[1]).join(url);
    await query(
      "UPDATE ghostwriter_posts SET image_url_2=$1, blog_body=$2, updated_at=now() WHERE id=$3",
      [url, body, post.id]
    );
  } else {
    await query("UPDATE ghostwriter_posts SET image_url=$1, updated_at=now() WHERE id=$2", [url, post.id]);
  }
}

/** GET: Referenzbild-Galerie des Tenants (echte Fotos zuerst) */
export async function GET(req) {
  const token = new URL(req.url).searchParams.get("token");
  const post = await findPostByReviewToken("preview", token);
  if (!post) return NextResponse.json({ error: "Ungültiger Link" }, { status: 404 });
  const { rows } = await query(
    `SELECT id, COALESCE(thumb_url, image_url) AS thumb, image_url, COALESCE(description,'') AS description,
            COALESCE(is_ai_generated,false) AS ai
     FROM tenant_reference_images
     WHERE tenant_id = $1 AND COALESCE(approval_status,'approved') != 'rejected'
     ORDER BY COALESCE(is_ai_generated,false) ASC, created_at DESC LIMIT 80`,
    [post.tenant_id]
  );
  return NextResponse.json({ ok: true, references: rows });
}

// Einfaches Rate-Limit pro Post: mode=generate stößt minutenlange Bild-Läufe
// auf dem Mac an — ungebremst wäre das ein Ressourcen-Loch (Audit 17.07.2026).
const recentCalls = new Map(); // postId -> [timestamps]
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 12;

function rateLimited(postId) {
  const now = Date.now();
  const calls = (recentCalls.get(postId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (calls.length >= RATE_MAX) return true;
  calls.push(now);
  recentCalls.set(postId, calls);
  if (recentCalls.size > 500) {
    for (const [k, v] of recentCalls) { if (!v.some((t) => now - t < RATE_WINDOW_MS)) recentCalls.delete(k); }
  }
  return false;
}

export async function POST(req) {
  // Token wird VOR dem Body-Parse geprüft (Query-Param) — sonst buffert
  // req.formData() beliebig große unauthentifizierte Uploads in den Speicher.
  const urlToken = new URL(req.url).searchParams.get("token");
  let post = null;
  if (urlToken) {
    post = await findPostByReviewToken("preview", urlToken);
    if (!post) return NextResponse.json({ error: "Ungültiger Link" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";
  let token, which, mode, prompt, referenceId, file;

  if (contentType.includes("multipart/form-data")) {
    if (!post) return NextResponse.json({ error: "Ungültiger Link" }, { status: 404 });
    const form = await req.formData();
    which = String(form.get("which") || "1");
    mode = String(form.get("mode") || "upload");
    prompt = form.get("prompt");
    file = form.get("file");
  } else {
    const body = await req.json().catch(() => ({}));
    ({ token, prompt, referenceId } = body);
    which = String(body.which || "1");
    mode = body.mode;
  }

  if (!post) {
    post = await findPostByReviewToken("preview", token);
    if (!post) return NextResponse.json({ error: "Ungültiger Link" }, { status: 404 });
  }
  if (post.status !== "draft_review") {
    return NextResponse.json({ error: "Artikel ist bereits veröffentlicht" }, { status: 409 });
  }
  if (rateLimited(post.id)) {
    return NextResponse.json({ error: "Zu viele Bild-Aktionen — bitte kurz warten" }, { status: 429 });
  }

  try {
    if (mode === "reference") {
      const { rows: [ref] } = await query(
        "SELECT id, image_url FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2",
        [referenceId, post.tenant_id]
      );
      if (!ref?.image_url) return NextResponse.json({ error: "Referenzbild nicht gefunden" }, { status: 404 });
      await applyImage(post, which, ref.image_url);
      syncClientCopy(post.id);
      await query(
        "UPDATE tenant_reference_images SET usage_count = COALESCE(usage_count,0)+1, last_used_at = now() WHERE id = $1",
        [ref.id]
      );
      return NextResponse.json({ ok: true, url: ref.image_url });
    }

    if (mode === "upload") {
      if (!file || typeof file.arrayBuffer !== "function") {
        return NextResponse.json({ error: "Keine Datei erhalten" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > 15 * 1024 * 1024) return NextResponse.json({ error: "Datei zu groß (max 15 MB)" }, { status: 413 });
      const ext = (file.name || "").toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1] || "jpg";
      const dir = path.join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      const filename = `upload-${post.blog_slug.slice(0, 40)}-${which}-${Date.now()}.${ext}`;
      await writeFile(path.join(dir, filename), buffer);
      const url = `${BASE_URL()}/uploads/${filename}`;
      await applyImage(post, which, url);
      syncClientCopy(post.id);
      return NextResponse.json({ ok: true, url });
    }

    if (mode === "generate") {
      const scene = String(prompt || "").trim();
      if (!scene) return NextResponse.json({ error: "Bitte Szene beschreiben" }, { status: 400 });
      const settings = await loadSettings(post.tenant_id);
      if (!settings) return NextResponse.json({ error: "Tenant-Settings fehlen" }, { status: 500 });

      // Optionale Vorlage: Galerie-Foto (referenceId) ODER frisch hochgeladenes Bild —
      // geht als Input an qwen-edit (neue Szene im Look des echten Fotos).
      let refUrl = null;
      if (referenceId) {
        const { rows: [ref] } = await query(
          "SELECT id, image_url FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2",
          [referenceId, post.tenant_id]
        );
        if (!ref?.image_url) return NextResponse.json({ error: "Referenzbild nicht gefunden" }, { status: 404 });
        refUrl = ref.image_url;
        await query(
          "UPDATE tenant_reference_images SET usage_count = COALESCE(usage_count,0)+1, last_used_at = now() WHERE id = $1",
          [ref.id]
        );
      } else if (file && typeof file.arrayBuffer === "function") {
        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.length > 15 * 1024 * 1024) return NextResponse.json({ error: "Datei zu groß (max 15 MB)" }, { status: 413 });
        const ext = (file.name || "").toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1] || "jpg";
        const dir = path.join(process.cwd(), "public", "uploads");
        await mkdir(dir, { recursive: true });
        const filename = `ref-${post.blog_slug.slice(0, 40)}-${Date.now()}.${ext}`;
        await writeFile(path.join(dir, filename), buffer);
        refUrl = `${BASE_URL()}/uploads/${filename}`;
      }

      const style = settings.image_style_prefix || DEFAULT_STYLE;
      // Ohne gewaehlte Vorlage: Web-Referenzen zur Szene suchen (Stani 23.07.2026)
      const refs = refUrl ? [refUrl] : await findWebReferences(`${scene} foto`, 2);
      // Marken-Stil gewinnt gegen Referenz-Farbwelt (Audit M7)
      const fullPrompt = refs.length
        ? `${scene}. MANDATORY BRAND STYLE — regrade colors, lighting and mood of the result to strictly match: ${style}. Keep only the composition idea from the reference image(s); the brand palette always wins.`
        : `${scene}. ${style}`;
      const result = await generateImage(settings, fullPrompt, `${post.blog_slug.slice(0, 40)}-edit${which}`, {
        format: "landscape",
        tenantReferenceImageUrls: refs,
      });
      await applyImage(post, which, result.url);
      syncClientCopy(post.id);
      return NextResponse.json({ ok: true, url: result.url });
    }

    return NextResponse.json({ error: "Unbekannter Modus" }, { status: 400 });
  } catch (err) {
    console.error("[image-update]", err?.message || err);
    return NextResponse.json({ error: `Fehlgeschlagen: ${String(err?.message || err).slice(0, 160)}` }, { status: 500 });
  }
}
