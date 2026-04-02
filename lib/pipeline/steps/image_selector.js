/**
 * Image Selector: LLM entscheidet welche Referenzbilder zum Artikel passen.
 * - Passendes Bild → direkt nutzen (kein KI-Generate)
 * - Kein passendes Bild → KI generiert neu
 */

import { query } from "../../db.js";
import { generateText } from "../../providers/text.js";

/**
 * @param {object} settings - Tenant settings (für LLM-Aufruf)
 * @param {object} article - Writer output (title)
 * @param {object} seo - SEO output (primaryKeyword)
 * @param {object} plan - Planner output (categoryLabel, angleName)
 * @param {string} tenantId - Tenant UUID
 * @returns {{ img1: object|null, img2: object|null }}
 *   img1 = Titelbild-Kandidat (oder null → KI generiert)
 *   img2 = Artikel-Innenbild-Kandidat (oder null → KI generiert)
 */
export async function selectReferenceImages(settings, article, seo, plan, tenantId) {
  // Referenzbilder laden (nur type='post', mit Beschreibung oder Kategorien)
  const { rows: images } = await query(
    `SELECT id, image_url, description, categories
     FROM tenant_reference_images
     WHERE tenant_id = $1 AND type = 'post'
       AND (approval_status = 'approved' OR approval_status IS NULL)
     ORDER BY created_at DESC`,
    [tenantId]
  );

  if (images.length === 0) return { img1: null, img2: null };

  // Nur Bilder die ausreichend beschrieben sind (sonst kann LLM nicht beurteilen)
  const usable = images.filter(
    img => (img.description?.trim()?.length > 5) || (img.categories?.length > 0)
  );
  if (usable.length === 0) return { img1: null, img2: null };

  const imageList = usable
    .map((img, i) => {
      const cats = (img.categories || []).join(", ") || "–";
      const desc = img.description?.trim() || "–";
      return `[${i + 1}] id=${img.id}\n  Beschreibung: ${desc}\n  Kategorien: ${cats}`;
    })
    .join("\n\n");

  const systemPrompt = "Du bist Bild-Redakteur. Entscheide welche vorhandenen Fotos zu einem Blog-Artikel passen.";
  const userPrompt = `ARTIKEL:
Titel: "${article.title}"
Kategorie: ${plan.categoryLabel}
Keyword: ${seo.primaryKeyword}
Thema/Angle: ${plan.angleName}

VERFÜGBARE REFERENZBILDER:
${imageList}

Entscheide:
1. img1 (Titelbild): Welches Bild passt am besten zum Artikel? Gib die id an oder null.
2. img2 (Artikel-Innenbild): Welches ANDERE Bild passt? Darf dasselbe sein wenn nur eines verfügbar. Oder null.

Streng urteilen: Nur wählen wenn die Beschreibung/Kategorie wirklich zum Artikel-Thema passt.
Wenn keins passt → null ausgeben.

Antworte NUR als JSON:
{"img1_id": "uuid-oder-null", "img2_id": "uuid-oder-null"}`;

  try {
    const raw = await generateText(settings, systemPrompt, userPrompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return { img1: null, img2: null };

    const sel = JSON.parse(match[0]);
    const byId = (rawId) => {
      if (!rawId || rawId === "null") return null;
      return usable.find(i => i.id === rawId) || null;
    };

    return { img1: byId(sel.img1_id), img2: byId(sel.img2_id) };
  } catch {
    return { img1: null, img2: null };
  }
}
