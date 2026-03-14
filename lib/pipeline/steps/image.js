/**
 * Step 4: BILDGENERATOR
 * Generates one image per article (shared across all languages)
 */

import { generateImage } from "../../providers/image.js";

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} article - Output from writer (title, slug, primary_keyword)
 * @param {object} seo - Output from SEO researcher
 * @returns {object} { url, localPath }
 */
export async function runImageGen(settings, article, seo) {
  const prompt = buildImagePrompt(article, seo, settings.image_style_prefix);
  return generateImage(settings, prompt, article.slug);
}

function buildImagePrompt(article, seo, stylePrefix) {
  const base = `Blog-Titelbild für: "${article.title}". Thema: ${seo.primaryKeyword}.`;
  const style = stylePrefix || "Fotorealistisch, professionell, keine KI-Gesichter, modernes Business-Ambiente";
  return `${style}. ${base} Querformat 4:3, 1200x900px. Kein Text im Bild.`;
}
