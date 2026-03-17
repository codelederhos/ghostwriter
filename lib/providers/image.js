/**
 * Image Provider Interface
 * Supports: OpenAI (dall-e-3 / gpt-image-1), Flux (fal.ai), Stock (Unsplash/Pexels), Custom URL
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/**
 * OpenAI Image Generation
 * - dall-e-3: returns URL (response_format: "url")
 * - gpt-image-1: returns base64 (b64_json only)
 */
async function generateOpenAIImage(apiKey, prompt, model = "gpt-image-1") {
  const isDalle3 = model === "dall-e-3";

  const body = isDalle3
    ? { model: "dall-e-3", prompt, n: 1, size: "1792x1024", quality: "standard", response_format: "url" }
    : { model, prompt, n: 1, size: "1536x1024", quality: "high" };

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  // gpt-image-1 returns base64
  return { type: "b64", value: item.b64_json };
}

async function generateFlux(apiKey, prompt) {
  const res = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: { width: 1200, height: 900 }, num_images: 1 }),
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
 * @returns {{ url: string, localPath: string }}
 */
export async function generateImage(settings, prompt, slug) {
  const provider = settings.image_provider || "dalle3";
  const apiKey = settings.image_api_key || process.env.OPENAI_API_KEY;
  // image_model: from settings or system default (gpt-image-1)
  const imageModel = settings.image_model || "gpt-image-1";

  let localPath;

  switch (provider) {
    case "dalle3": {
      const result = await generateOpenAIImage(apiKey, prompt, imageModel);
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
