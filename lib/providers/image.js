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

    // FormData für Edit-API
    const { FormData, Blob } = await import("formdata-node");
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
async function saveFromUrl(imageUrl, slug) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = imageUrl.includes(".png") ? "png" : "jpg";
  const filename = `${slug}-${Date.now()}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
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
    case "custom":
      localPath = await saveFromUrl(settings.image_custom_endpoint, slug);
      break;
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  return { url: `${baseUrl}${localPath}`, localPath };
}
