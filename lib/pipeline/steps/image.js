/**
 * Step 4: BILDGENERATOR
 * Generates 2 images per article:
 *   1. Blog-Titelbild (in den Artikel eingebaut)
 *   2. GBP-Bild (für Google Firmenseite)
 */

import { generateImage } from "../../providers/image.js";

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} article - Output from writer (title, slug, primary_keyword)
 * @param {object} seo - Output from SEO researcher
 * @returns {object} { url, localPath, url2, localPath2 }
 */
export async function runImageGen(settings, article, seo) {
  // Bild 1: Blog-Titelbild
  const prompt1 = buildBlogImagePrompt(article, seo, settings.image_style_prefix);
  const img1 = await generateImage(settings, prompt1, article.slug);

  // Bild 2: GBP-Bild (kompakter, Social-Media-tauglich)
  let img2 = { url: null, localPath: null };
  try {
    const prompt2 = buildGbpImagePrompt(article, seo, settings.image_style_prefix);
    img2 = await generateImage(settings, prompt2, `${article.slug}-gbp`);
  } catch {
    // GBP-Bild optional — wenn es fehlschlägt, Bild 1 wiederverwenden
    img2 = { ...img1 };
  }

  return {
    url: img1.url,
    localPath: img1.localPath,
    url2: img2.url,
    localPath2: img2.localPath,
  };
}

function buildBlogImagePrompt(article, seo, stylePrefix) {
  const base = `Blog-Titelbild für: "${article.title}". Thema: ${seo.primaryKeyword}.`;
  const style = stylePrefix || "Fotorealistisch, professionell, keine KI-Gesichter, modernes Business-Ambiente";
  return `${style}. ${base} Querformat 16:9, 1200x675px. Kein Text im Bild.`;
}

function buildGbpImagePrompt(article, seo, stylePrefix) {
  const base = `Social-Media-Bild für Google Business: "${article.title}". Kernthema: ${seo.primaryKeyword}.`;
  const style = stylePrefix || "Fotorealistisch, professionell, einladend, keine KI-Gesichter";
  return `${style}. ${base} Quadratisch 1:1, 800x800px. Kein Text, kein Logo. Emotionaler Bildinhalt der zum Klicken einlädt.`;
}
