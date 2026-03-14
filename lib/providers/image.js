/**
 * Image Provider Interface
 * Supports: DALL-E 3, Flux (fal.ai), Stock (Unsplash), Custom URL
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function generateDalle3(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1792x1024",
      quality: "standard",
      response_format: "url",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DALL-E 3 ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data[0].url;
}

async function generateFlux(apiKey, prompt) {
  // fal.ai Flux endpoint
  const res = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: 1200, height: 900 },
      num_images: 1,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Flux/fal.ai ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.images?.[0]?.url || data.output?.url;
}

async function fetchStock(keyword) {
  // Unsplash free API (no key needed for basic)
  const query = encodeURIComponent(keyword);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${query}&per_page=1&orientation=landscape`,
    {
      headers: {
        Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY || ""}`,
      },
    }
  );
  if (!res.ok) {
    // Fallback: Pexels
    return fetchPexels(keyword);
  }
  const data = await res.json();
  if (data.results?.length > 0) {
    return data.results[0].urls.regular;
  }
  return null;
}

async function fetchPexels(keyword) {
  const query = encodeURIComponent(keyword);
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`,
    {
      headers: {
        Authorization: process.env.PEXELS_API_KEY || "",
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.photos?.[0]?.src?.large || null;
}

/**
 * Download image from URL and save locally
 * @returns {string} Local path relative to /public
 */
async function downloadAndSave(imageUrl, slug) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = imageUrl.includes(".png") ? "png" : "jpg";
  const filename = `${slug}-${Date.now()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await writeFile(filepath, buffer);
  return `/uploads/${filename}`;
}

/**
 * Generate or fetch an image using the tenant's configured provider
 * @param {object} settings - Decrypted tenant settings
 * @param {string} prompt - Image description
 * @param {string} slug - For filename
 * @returns {{ url: string, local: boolean }} Image URL
 */
export async function generateImage(settings, prompt, slug) {
  const provider = settings.image_provider || "dalle3";
  const apiKey = settings.image_api_key || process.env.OPENAI_API_KEY;
  const stylePrefix = settings.image_style_prefix || "";
  const fullPrompt = stylePrefix ? `${stylePrefix}. ${prompt}` : prompt;

  let remoteUrl;

  switch (provider) {
    case "dalle3":
      remoteUrl = await generateDalle3(apiKey, fullPrompt);
      break;
    case "flux":
      remoteUrl = await generateFlux(apiKey, fullPrompt);
      break;
    case "stock":
      remoteUrl = await fetchStock(prompt);
      if (!remoteUrl) throw new Error("No stock image found for: " + prompt);
      break;
    case "custom":
      // Custom provider returns URL directly
      remoteUrl = settings.image_custom_url;
      break;
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }

  // Download and store locally
  const localPath = await downloadAndSave(remoteUrl, slug);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  return { url: `${baseUrl}${localPath}`, localPath };
}
