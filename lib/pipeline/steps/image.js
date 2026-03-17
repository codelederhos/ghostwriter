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
/**
 * Generiert 2 Bilder:
 *  img1 = Blog-Titelbild (Header, 16:9)
 *  img2 = Artikel-Innenbild (kontextuell, 16:9) — ersetzt <!-- IMAGE_2 --> im body_html
 */
export async function runImageGen(settings, article, seo) {
  // KI-generierte Prompts aus Writer bevorzugen, sonst Fallback
  const style = settings.image_style_prefix || "Photorealistic, professional, no faces, no text, modern business atmosphere";
  const prompt1 = article.image_prompt_1
    ? `${style}. ${article.image_prompt_1}`
    : buildImagePrompt(article, seo, settings.image_style_prefix, "title");

  const img1 = await generateImage(settings, prompt1, article.slug);

  let img2 = { url: null, localPath: null };
  try {
    const prompt2 = article.image_prompt_2
      ? `${style}. ${article.image_prompt_2}`
      : buildImagePrompt(article, seo, settings.image_style_prefix, "article");
    img2 = await generateImage(settings, prompt2, `${article.slug}-2`);
  } catch {
    img2 = { ...img1 };
  }

  // <!-- IMAGE_2 --> Platzhalter im body_html ersetzen
  if (img2.url && article.body_html?.includes("<!-- IMAGE_2 -->")) {
    article.body_html = article.body_html.replace(
      "<!-- IMAGE_2 -->",
      `<figure class="article-figure"><img src="${img2.url}" alt="${seo.primaryKeyword}" loading="lazy" /></figure>`
    );
  }

  return {
    url: img1.url,
    localPath: img1.localPath,
    url2: img2.url,
    localPath2: img2.localPath,
  };
}

function buildImagePrompt(article, seo, stylePrefix, type) {
  const style = stylePrefix || "Fotorealistisch, professionell, keine KI-Gesichter, modernes Business-Ambiente";
  if (type === "title") {
    return `${style}. Blog-Titelbild: "${article.title}". Thema: ${seo.primaryKeyword}. Querformat 16:9. Kein Text im Bild.`;
  }
  return `${style}. Redaktionelles Artikel-Foto zum Thema ${seo.primaryKeyword}. Querformat 16:9. Kein Text, kein Logo. Andere Perspektive als das Titelbild.`;
}
