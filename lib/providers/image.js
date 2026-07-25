/**
 * Image Provider Interface
 * Supports: OpenAI (dall-e-3 / gpt-image-1), Flux (fal.ai), Stock (Unsplash/Pexels), Custom URL
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

// Bildformat-Map: format → gpt-image-1-Größe
const IMAGE_SIZES = {
  landscape: "1536x1024",
  portrait:  "1024x1536",
  square:    "1024x1024",
};

/**
 * OpenAI Image Generation
 * - dall-e-3: returns URL (response_format: "url")
 * - gpt-image-1: returns base64 (b64_json only)
 * @param {string} format - "landscape" | "portrait" | "square" (default: landscape)
 * @param {string|null} referenceImageUrl - URL eines Referenzbildes (nur gpt-image-1)
 */
async function generateOpenAIImage(apiKey, prompt, model = "gpt-image-1", format = "landscape", referenceImageUrl = null) {
  const isDalle3 = model === "dall-e-3";
  const size = isDalle3 ? "1792x1024" : (IMAGE_SIZES[format] || IMAGE_SIZES.landscape);

  // gpt-image-1 Edit-API wenn Referenzbild vorhanden
  if (!isDalle3 && referenceImageUrl) {
    return generateOpenAIImageWithReference(apiKey, prompt, model, size, referenceImageUrl);
  }

  const body = isDalle3
    ? { model: "dall-e-3", prompt, n: 1, size, quality: "standard", response_format: "url" }
    : { model, prompt, n: 1, size, quality: "high" };

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min max — gpt-image-1 normal ~60s
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Image (${model}) ${res.status}: ${err}`);
  }

  const data = await res.json();
  const item = data.data[0];

  if (isDalle3) {
    return { type: "url", value: item.url };
  }
  return { type: "b64", value: item.b64_json };
}

/**
 * gpt-image-1 Edit-API: Generiert auf Basis eines Referenzbildes
 */
async function generateOpenAIImageWithReference(apiKey, prompt, model, size, referenceImageUrl) {
  try {
    // Referenzbild herunterladen
    const imgRes = await fetch(referenceImageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) throw new Error("Reference image not reachable");
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpeg";

    // FormData für Edit-API (Node 18+ nativ)
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("n", "1");
    form.set("size", size);
    form.set("image", new Blob([imgBuffer], { type: `image/${ext}` }), `reference.${ext}`);

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      // Fallback: ohne Referenz generieren
      const err = await res.text();
      console.warn(`[ImageEdit] Fallback to generate (${res.status}): ${err.slice(0, 200)}`);
      return generateOpenAIImage(apiKey, prompt, model, size === IMAGE_SIZES.portrait ? "portrait" : "landscape");
    }

    const data = await res.json();
    return { type: "b64", value: data.data[0].b64_json };
  } catch (e) {
    console.warn(`[ImageEdit] Reference failed, falling back: ${e.message}`);
    return generateOpenAIImage(apiKey, prompt, model);
  }
}

async function generateFlux(apiKey, prompt) {
  const res = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: { width: 1200, height: 900 }, num_images: 1 }),
    signal: AbortSignal.timeout(120_000), // 2 min max
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Flux/fal.ai ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.images?.[0]?.url || data.output?.url;
}

async function fetchStock(keyword) {
  const query = encodeURIComponent(keyword);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${query}&per_page=1&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY || ""}` } }
  );
  if (res.ok) {
    const data = await res.json();
    if (data.results?.length > 0) return data.results[0].urls.regular;
  }
  return fetchPexels(keyword);
}

async function fetchPexels(keyword) {
  const query = encodeURIComponent(keyword);
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`,
    { headers: { Authorization: process.env.PEXELS_API_KEY || "" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.photos?.[0]?.src?.large || null;
}

/** Download a URL and save locally */
async function saveFromUrl(imageUrl, slug, headers = {}) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const res = await fetch(imageUrl, { headers, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = imageUrl.includes(".webp") ? "webp" : imageUrl.includes(".png") ? "png" : "jpg";
  const filename = `${slug}-${Date.now()}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

/**
 * img-studio (Stanis Mac, lokale Modelle): Batch starten, Status pollen,
 * fertiges Bild von der öffentlichen outputs-Media-URL laden.
 * PFLICHT-Provider für alle Tenant-Bilder — keine Cloud-Bildmodelle.
 * Mac aus → Studio-Queue puffert; nach Timeout übernimmt der Backfill-Cron (07:45).
 */
/**
 * Web-Referenzbilder zum konkreten Thema via SearXNG-Bildersuche (lokal).
 * Stani 23.07.2026: JEDES Artikelbild bekommt echte Foto-Referenzen aus der
 * Themen-Recherche, Generierung laeuft dann IMMER ueber qwen-edit — reines
 * Text-krea2 nur noch als Notnagel. Wasserzeichen-Stock und Vektoren fliegen raus.
 */
const WEBREF_BLOCK = /freepik|shutterstock|istock|alamy|gettyimages|dreamstime|depositphotos|123rf|vectorstock|adobe\.com|stock\.adobe|lookaside\.instagram|vektor|vector|clipart|logo/i;
export async function findWebReferences(query, max = 2) {
  try {
    const base = process.env.SEARXNG_URL || "http://searxng:8080";
    const r = await fetch(`${base}/search?` + new URLSearchParams({ q: query, categories: "images", format: "json" }), {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    // Kandidaten grosszuegig sammeln (Audit 23.07.: zu scharfe Filter liessen
    // von 176 Treffern nur 2 uebrig, oft 0 -> alles fiel auf krea2 zurueck).
    // Ladbarkeit prueft der Download (Content-Type), nicht die URL-Form.
    const picks = [];
    for (const item of d.results || []) {
      let url = item.img_src || "";
      if (!url) continue;
      if (url.startsWith("//")) url = "https:" + url;
      if (!/^https?:\/\//i.test(url)) continue;
      if (WEBREF_BLOCK.test(url) || WEBREF_BLOCK.test(item.title || "")) continue;
      const res = String(item.resolution || "").match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (res && (Number(res[1]) < 600 || Number(res[2]) < 400)) continue;
      picks.push(url);
      if (picks.length >= Math.max(max, 6)) break;
    }
    if (picks.length) console.log(`[image] ${picks.length} Web-Referenz(en) fuer "${query.slice(0, 60)}"`);
    return picks;
  } catch (e) {
    console.warn("[image] Web-Referenz-Suche fehlgeschlagen:", e.message);
    return [];
  }
}

/** Referenzfoto (Tenant-Galerie, Upload oder Web-Recherche — Stani-Entscheid
 *  23.07.2026) als base64 laden. Bild-Validierung via Content-Type, nicht URL-Form. */
async function loadReferenceB64(url) {
  const abs = url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_BASE_URL || "https://ghostwriter.code-lederhos.de"}${url}`;
  const res = await fetch(abs, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (compatible; gw-image/1.0)" } });
  if (!res.ok) throw new Error(`Referenzbild nicht ladbar (${res.status})`);
  const ctype = res.headers.get("content-type") || "";
  if (!/^image\/(jpe?g|png|webp)/i.test(ctype)) throw new Error(`kein Bild (${ctype.slice(0, 40)})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 12 * 1024 * 1024) throw new Error("Referenzbild zu groß (max 12 MB)");
  if (buf.length < 8000) throw new Error("Referenzbild zu klein (Thumbnail/Platzhalter)");
  return buf.toString("base64");
}

async function generateImgStudio(prompt, format, settings, opts = {}) {
  const base = (process.env.IMGSTUDIO_URL || "https://img-studio-local.code-lederhos.de").replace(/\/+$/, "");
  const token = process.env.IMGSTUDIO_TOKEN;
  if (!token) throw new Error("IMGSTUDIO_TOKEN fehlt (docker-compose env)");
  let model = settings.image_model && !/gpt|dall/i.test(settings.image_model) ? settings.image_model : "krea2";
  const [width, height] = format === "portrait" ? [768, 1344] : format === "square" ? [1024, 1024] : [1344, 768];

  // Referenz-Generierung: eigenes Foto als Input -> qwen-edit (kann 1-3 Input-Bilder),
  // krea2 ist rein Text-zu-Bild. Neue Szene im Look des echten Fotos.
  // Kandidaten der Reihe nach laden, bis 2 Erfolge (Audit K2: vorher konnten
  // ALLE Downloads still scheitern -> unbemerkter krea2-Fallback)
  const refUrls = (opts.tenantReferenceImageUrls || []).filter(Boolean);
  const inputImagesB64 = [];
  for (const u of refUrls) {
    if (inputImagesB64.length >= 2) break;
    try { inputImagesB64.push(await loadReferenceB64(u)); } catch (e) { console.warn("[img-studio] Referenz übersprungen:", e.message); }
  }
  if (refUrls.length && !inputImagesB64.length) {
    console.error(`[img-studio] ALLE ${refUrls.length} Referenzen nicht ladbar — degradiere zu ${model} (Text-only)`);
  }
  if (inputImagesB64.length) model = settings.image_ref_model || "qwen-edit";
  if (opts._meta) opts._meta.loadedRefs = inputImagesB64.length;

  const startRes = await fetch(`${base}/api/generate/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      prompt, models: [model], width, height, count: 1,
      batchLabel: inputImagesB64.length ? "gw-pipeline-ref" : "gw-pipeline",
      ...(inputImagesB64.length ? { inputImagesB64 } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!startRes.ok) throw new Error(`img-studio batch ${startRes.status}`);
  const startJson = await startRes.json();
  const genId = startJson?.data?.generationIds?.[0];
  if (!genId) throw new Error("img-studio: keine generationId");

  const deadline = Date.now() + (inputImagesB64.length ? 9 : 6) * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10000));
    const st = await fetch(`${base}/api/generate/${genId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!st.ok) continue;
    const j = await st.json();
    const status = j?.data?.status;
    if (status === "FAILED") throw new Error(`img-studio FAILED: ${(j?.data?.error || "").slice(0, 120)}`);
    if (status === "DONE" && j?.data?.outputImage) {
      const rel = j.data.outputImage;
      return rel.startsWith("http") ? rel : `${base}${rel}`;
    }
  }
  throw new Error("img-studio Timeout (Mac offline? Backfill-Cron holt nach)");
}

/** Save base64 image data locally */
async function saveFromBase64(b64, slug) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${slug}-${Date.now()}.png`;
  await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(b64, "base64"));
  return `/uploads/${filename}`;
}

/**
 * Generate or fetch an image using the tenant's configured provider
 * @param {object} settings - Decrypted tenant settings
 * @param {string} prompt - Image description
 * @param {string} slug - For filename
 * @param {object} options - { format: "landscape"|"portrait"|"square", referenceImageUrl?: string }
 * @returns {{ url: string, localPath: string }}
 */
export async function generateImage(settings, prompt, slug, options = {}) {
  const provider = settings.image_provider || "dalle3";
  const apiKey = settings.image_api_key || process.env.OPENAI_API_KEY;
  const imageModel = settings.image_model || "gpt-image-1";
  const format = options.format || "landscape";
  const referenceImageUrl = options.referenceImageUrl || null;

  let localPath;

  switch (provider) {
    case "dalle3": {
      const result = await generateOpenAIImage(apiKey, prompt, imageModel, format, referenceImageUrl);
      if (result.type === "url") {
        localPath = await saveFromUrl(result.value, slug);
      } else {
        localPath = await saveFromBase64(result.value, slug);
      }
      break;
    }
    case "flux": {
      const remoteUrl = await generateFlux(apiKey, prompt);
      localPath = await saveFromUrl(remoteUrl, slug);
      break;
    }
    case "stock": {
      const remoteUrl = await fetchStock(prompt);
      if (!remoteUrl) throw new Error("No stock image found for: " + prompt);
      localPath = await saveFromUrl(remoteUrl, slug);
      break;
    }
    case "imgstudio": {
      // options.referenceImageUrl (Web-Bilder aus der Research) wird hier BEWUSST
      // ignoriert — nur eigene Tenant-Fotos gehen als Generier-Input rein.
      const refs = options.tenantReferenceImageUrls
        || (options.tenantReferenceImageUrl ? [options.tenantReferenceImageUrl] : []);
      const meta = { loadedRefs: 0 };
      const remoteUrl = await generateImgStudio(prompt, format, settings, {
        tenantReferenceImageUrls: refs,
        _meta: meta,
      });
      options._loadedRefs = meta.loadedRefs;
      // img-studio media-Route ist Bearer-geschützt (seit Studio-Hardening 07/2026)
      localPath = await saveFromUrl(remoteUrl, slug, { Authorization: `Bearer ${process.env.IMGSTUDIO_TOKEN}` });
      break;
    }
    case "custom":
      localPath = await saveFromUrl(settings.image_custom_endpoint, slug);
      break;
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  return { url: `${baseUrl}${localPath}`, localPath };
}
