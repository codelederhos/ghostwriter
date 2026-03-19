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
 * @param {object} article - Output from writer (title, slug, body_html, image_prompt_1/2, image_format_1/2)
 * @param {object} seo - Output from SEO researcher
 * @param {object} plan - Output from planner (categoryLabel, angleName)
 * @param {string|null} tenantId - Tenant UUID (für Referenzbild-Lookup)
 * @param {string[]} referenceImageUrls - Optionale Web-Referenzbilder aus Research
 * @returns {{ url, localPath, url2, localPath2, img1Source, img2Source }}
 *   imgNSource: "reference" | "generated" | "web-reference"
 */
export async function runImageGen(settings, article, seo, plan = {}, tenantId = null, referenceImageUrls = []) {
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

  // Formate aus Writer-Entscheidung (landscape/portrait/square), default: landscape
  const format1 = article.image_format_1 || "landscape";
  const format2 = article.image_format_2 || "landscape";

  // Web-Referenzbild für Generierung (erstes brauchbares aus Research)
  const webRef1 = referenceImageUrls[0] || null;
  const webRef2 = referenceImageUrls[1] || null;

  // Step 2+3: Titelbild (img1) + Innenbild (img2) — parallel generieren
  const prompt1 = article.image_prompt_1
    ? `${style}. ${article.image_prompt_1}`
    : buildImagePrompt(article, seo, settings.image_style_prefix, "title");
  const prompt2 = article.image_prompt_2
    ? `${style}. ${article.image_prompt_2}`
    : buildImagePrompt(article, seo, settings.image_style_prefix, "article");

  const img1Promise = refSelection.img1
    ? Promise.resolve({ url: refSelection.img1.image_url, localPath: refSelection.img1.image_url })
    : generateImage(settings, prompt1, article.slug, { format: format1, referenceImageUrl: webRef1 });

  const img2Promise = refSelection.img2
    ? Promise.resolve({ url: refSelection.img2.image_url, localPath: refSelection.img2.image_url })
    : generateImage(settings, prompt2, `${article.slug}-2`, { format: format2, referenceImageUrl: webRef2 });

  const [img1Result, img2Result] = await Promise.allSettled([img1Promise, img2Promise]);

  if (img1Result.status === "rejected") throw img1Result.reason;

  let img1 = img1Result.value;
  let img1Source = refSelection.img1 ? "reference" : webRef1 ? "web-reference" : "generated";

  let img2 = img2Result.status === "fulfilled" ? img2Result.value : { ...img1 };
  let img2Source = img2Result.status === "rejected"
    ? img1Source
    : refSelection.img2 ? "reference" : webRef2 ? "web-reference" : "generated";

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
