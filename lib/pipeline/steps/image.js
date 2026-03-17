/**
 * Step 4: BILDGENERATOR
 * Ablauf:
 *   1. Referenzbilder aus DB prüfen → LLM entscheidet ob passend
 *   2. Passendes Bild → direkt nutzen (kein API-Call, kein Kosten)
 *   3. Kein passendes Bild → KI generiert neu
 *
 * Blog-Post hat 2 Bilder:
 *   img1 = Titelbild (Header, 16:9) — auch für Posts + Google genutzt
 *   img2 = Artikel-Innenbild — ersetzt <!-- IMAGE_2 --> im body_html
 */

import { generateImage } from "../../providers/image.js";
import { selectReferenceImages } from "./image_selector.js";

/**
 * @param {object} settings - Decrypted tenant settings
 * @param {object} article - Output from writer (title, slug, body_html, image_prompt_1/2)
 * @param {object} seo - Output from SEO researcher
 * @param {object} plan - Output from planner (categoryLabel, angleName)
 * @param {string|null} tenantId - Tenant UUID (für Referenzbild-Lookup)
 * @returns {{ url, localPath, url2, localPath2, img1Source, img2Source }}
 *   imgNSource: "reference" | "generated"
 */
export async function runImageGen(settings, article, seo, plan = {}, tenantId = null) {
  const style = settings.image_style_prefix || "Photorealistic, professional, no faces, no text, modern business atmosphere";

  // Step 1: Referenzbild-Selektion (kostenlos, nur DB + ein kurzer LLM-Call)
  let refSelection = { img1: null, img2: null };
  if (tenantId) {
    try {
      refSelection = await selectReferenceImages(settings, article, seo, plan, tenantId);
    } catch {
      // Fehlschlag ist OK — dann generieren wir neu
    }
  }

  // Step 2: Titelbild (img1)
  let img1;
  let img1Source = "generated";

  if (refSelection.img1) {
    // Passendes Referenzbild gefunden → direkt nutzen
    img1 = {
      url: refSelection.img1.image_url,
      localPath: refSelection.img1.image_url,
    };
    img1Source = "reference";
  } else {
    // KI generiert neues Bild
    const prompt1 = article.image_prompt_1
      ? `${style}. ${article.image_prompt_1}`
      : buildImagePrompt(article, seo, settings.image_style_prefix, "title");
    img1 = await generateImage(settings, prompt1, article.slug);
  }

  // Step 3: Artikel-Innenbild (img2)
  let img2 = { url: null, localPath: null };
  let img2Source = "generated";

  try {
    if (refSelection.img2) {
      img2 = {
        url: refSelection.img2.image_url,
        localPath: refSelection.img2.image_url,
      };
      img2Source = "reference";
    } else {
      const prompt2 = article.image_prompt_2
        ? `${style}. ${article.image_prompt_2}`
        : buildImagePrompt(article, seo, settings.image_style_prefix, "article");
      img2 = await generateImage(settings, prompt2, `${article.slug}-2`);
    }
  } catch {
    // Fallback: Titelbild auch als Innenbild
    img2 = { ...img1 };
    img2Source = img1Source;
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
    img1Source,
    img2Source,
  };
}

function buildImagePrompt(article, seo, stylePrefix, type) {
  const style = stylePrefix || "Fotorealistisch, professionell, keine KI-Gesichter, modernes Business-Ambiente";
  if (type === "title") {
    return `${style}. Blog-Titelbild: "${article.title}". Thema: ${seo.primaryKeyword}. Querformat 16:9. Kein Text im Bild.`;
  }
  return `${style}. Redaktionelles Artikel-Foto zum Thema ${seo.primaryKeyword}. Querformat 16:9. Kein Text, kein Logo. Andere Perspektive als das Titelbild.`;
}
