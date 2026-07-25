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

import { generateImage, findWebReferences } from "../../providers/image.js";
import { selectReferenceImages } from "./image_selector.js";
import { query } from "../../db.js";
import { buildArticleImageHtml } from "../media-contract.js";

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
export async function runImageGen(settings, article, seo, plan = {}, tenantId = null, referenceImageUrls = [], opts = {}) {
  const imageGenEnabled = opts.imageGenEnabled === true;
  // Stani 14.07.2026: Bilder immer hell, freundlich, edel-modern — nie düster/boho
  const style = settings.image_style_prefix || "Bright airy premium editorial photograph, photorealistic, high-end magazine quality. Modern elegant setting, clean minimal styling, light neutral tones with warm accents, soft natural daylight from large windows, friendly optimistic mood, real candid scene with genuine emotion. People with Central European appearance, naturally from behind, in profile or softly out of focus, never looking at the camera, wearing modern everyday clothing (jeans, casual shirts, smart business casual) — never linen dresses, flowy cream garments or rustic outfits. No text, no logos, no dark moody lighting, no spotlight on dark background, no rustic boho props";

  // Step 1: Referenzbild-Selektion (kostenlos, nur DB + ein kurzer LLM-Call)
  let refSelection = { img1: null, img2: null };
  if (tenantId) {
    try {
      refSelection = await selectReferenceImages(settings, article, seo, plan, tenantId);
    } catch {
      // Fehlschlag ist OK — dann generieren wir neu
    }
  }

  // Artikelmedien folgen einem gemeinsamen breiten Vertrag. Das frühere
  // erzwungene Gegenformat produzierte riesige Hochformatblöcke und machte
  // Mandanten-CSS unnötig fragil.
  const format1 = "landscape";
  const format2 = "landscape";
  article.image_format_1 = format1;
  article.image_format_2 = format2;

  // Web-Referenzbild für Generierung (erstes brauchbares aus Research)
  const webRef1 = referenceImageUrls[0] || null;
  const webRef2 = referenceImageUrls[1] || null;

  // Referenz-Kaskade (Stani 23.07.2026): eigenes Tenant-Foto zuerst, sonst
  // Web-Recherche zum konkreten Thema — jedes generierte Bild laeuft mit
  // Foto-Referenz ueber qwen-edit, reines Text-krea2 nur noch als Notnagel.
  let styleRefUrl = refSelection.styleRef?.image_url || null;
  let webRefs = [];
  if (!styleRefUrl && imageGenEnabled && (!refSelection.img1 || !refSelection.img2)) {
    const query = `${article.title || seo.primaryKeyword || ""} foto`.trim();
    webRefs = await findWebReferences(query, 2);
    if (!webRefs.length) {
      await (async () => console.warn("[image] KEINE Web-Referenz gefunden — krea2-Notnagel fuer:", query.slice(0, 60)))();
    }
  }
  const refs1 = styleRefUrl ? [styleRefUrl]
    : (webRefs.length ? webRefs : (refSelection.img2?.image_url ? [refSelection.img2.image_url] : []));
  const refs2 = styleRefUrl ? [styleRefUrl]
    : (webRefs.length ? webRefs : (refSelection.img1?.image_url ? [refSelection.img1.image_url] : []));

  // Step 2+3: Titelbild (img1) + Innenbild (img2) — parallel generieren
  // Szene ZUERST, Stil danach (Studio-Verlauf-Sichtbarkeit). Bei Referenz-
  // Laeufen wird der MARKEN-Stil als Imperativ verstaerkt — qwen-edit klebt
  // sonst an der Farbwelt der Vorlage und die Firmenfarben gehen unter
  // (Stani 23.07.2026: "staned hat emerald und das fehlt komplett").
  const styleFor = (scene, hasRefs) => hasRefs
    ? `${scene}. MANDATORY BRAND STYLE — regrade colors, lighting and mood of the result to strictly match: ${style}. Keep only the composition idea from the reference image(s); the brand palette always wins over the reference colors. Wide editorial composition for a 16:9 article crop. No readable text, no fake user interfaces, no floating HUD elements, no neon cyber clichés, no generic staged office scene.`
    : `${scene}. ${style}. Wide editorial composition for a 16:9 article crop. No readable text, no fake user interfaces, no floating HUD elements, no neon cyber clichés, no generic staged office scene.`;
  const prompt1 = article.image_prompt_1
    ? styleFor(article.image_prompt_1, refs1.length > 0)
    : buildImagePrompt(article, seo, settings.image_style_prefix, "title");
  const prompt2 = article.image_prompt_2
    ? styleFor(article.image_prompt_2, refs2.length > 0)
    : buildImagePrompt(article, seo, settings.image_style_prefix, "article");

  const noImg = { url: null, localPath: null, _skipped: true };
  const img1Promise = refSelection.img1
    ? Promise.resolve({ url: refSelection.img1.image_url, localPath: refSelection.img1.image_url })
    : (imageGenEnabled
        ? generateImage(settings, prompt1, article.slug, { format: format1, referenceImageUrl: webRef1, tenantReferenceImageUrls: refs1 })
        : Promise.resolve(noImg));

  const img2Promise = refSelection.img2
    ? Promise.resolve({ url: refSelection.img2.image_url, localPath: refSelection.img2.image_url })
    : (imageGenEnabled
        // Innenbild bekommt dieselbe Foto-Referenz wie das Titelbild (22.07.2026:
        // img2 war der letzte rein KI-generierte Pfad — Doppel-Panels, Leinen-Looks)
        ? generateImage(settings, prompt2, `${article.slug}-2`, { format: format2, referenceImageUrl: webRef2, tenantReferenceImageUrls: refs2 })
        : Promise.resolve(noImg));

  const [img1Result, img2Result] = await Promise.allSettled([img1Promise, img2Promise]);

  if (img1Result.status === "rejected") throw img1Result.reason;

  let img1 = img1Result.value;
  let img1Source = refSelection.img1 ? "reference" : (img1?._skipped ? "none" : (refs1.length ? "generated-ref" : "generated"));
  if (img1Source === "generated-ref" && refSelection.styleRef?.id) {
    try {
      await query(
        "UPDATE tenant_reference_images SET usage_count = COALESCE(usage_count,0)+1, last_used_at = now() WHERE id = $1",
        [refSelection.styleRef.id]
      );
    } catch { /* Tracking-Fehler ignorieren */ }
  }

  let img2 = img2Result.status === "fulfilled" ? img2Result.value : { ...img1 };
  let img2Source = img2Result.status === "rejected"
    ? img1Source
    : refSelection.img2 ? "reference" : (img2?._skipped ? "none" : (refs2.length ? "generated-ref" : "generated"));

  // <!-- IMAGE_2 --> Platzhalter im body_html ersetzen
  if (img2.url && article.body_html?.includes("<!-- IMAGE_2 -->")) {
    article.body_html = article.body_html.replace(
      "<!-- IMAGE_2 -->",
      buildArticleImageHtml({
        src: img2.url,
        alt: seo.primaryKeyword || article.title || "Artikelbild",
      })
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
  const cam = "Canon 5D Mark IV 35mm f/2.8 lens";
  const base = stylePrefix || `Shot on ${cam}, Kodak Portra 400 film grain, no faces, no text, no logos`;
  if (type === "title") {
    return `${base}, golden hour warm light, ${seo.primaryKeyword} scene, authentic natural setting, professional architectural photography, real-world imperfections`;
  }
  return `${base}, soft overcast daylight, ${seo.primaryKeyword} detail shot, different perspective from title image, Hasselblad medium format quality, environmental context`;
}
