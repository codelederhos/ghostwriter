/**
 * Image Selector mit Rotation:
 * - Score-Penalty fuer haeufig genutzte Bilder (max -30)
 * - Recency-Bonus fuer lange nicht genutzte Bilder (max +30)
 * - LLM bekommt Nutzungs-Info im Kandidaten-Listing
 * - Nach Auswahl: usage_count++ + last_used_at=now()
 */
import { query } from "../../db.js";
import { generateText } from "../../providers/text.js";

export async function selectReferenceImages(settings, article, seo, plan, tenantId) {
  const { rows: images } = await query(
    `SELECT id, image_url, description, categories,
            COALESCE(is_ai_generated,false) AS is_ai,
            COALESCE(usage_count,0) AS usage_count,
            last_used_at,
            EXTRACT(EPOCH FROM (now() - COALESCE(last_used_at, now() - interval '90 days'))) / 86400.0 AS days_since_used
       FROM tenant_reference_images
      WHERE tenant_id = $1 AND type = 'post'
        AND (approval_status = 'approved' OR approval_status IS NULL)
      ORDER BY created_at DESC`,
    [tenantId]
  );

  if (images.length === 0) return { img1: null, img2: null, styleRef: null };

  // Baustellen-/Abriss-Dokufotos sind keine Hero-Bilder (Stani 15.07.2026:
  // Schutt-Foto als Titelbild eines Denkmal-Artikels) — hart ausfiltern.
  const UGLY_RE = /abriss|abbruch|schutt|tr(ü|ue)mmer|baustelle|entkernung|ruine|rohbau|demolition|rubble|debris|construction site|gutted/i;

  const usable = images.filter(
    img => ((img.description?.trim()?.length > 5) || (img.categories?.length > 0))
      && !UGLY_RE.test(`${img.description || ""} ${Array.isArray(img.categories) ? img.categories.join(" ") : img.categories || ""}`)
  );
  if (usable.length === 0) return { img1: null, img2: null, styleRef: null };

  // Rotation-Scoring
  const scored = usable.map(img => {
    const usage = Number(img.usage_count) || 0;
    const days = Number(img.days_since_used) || 90;
    const rotation_penalty = Math.min(usage * 5, 30);
    const recency_bonus = Math.min(days * 1.5, 30);
    return { ...img, rotation_penalty, recency_bonus, days: Math.round(days), usage };
  });

  const imageList = scored
    .map((img, i) => {
      const cats = (img.categories || []).join(", ") || "-";
      const desc = img.description?.trim() || "-";
      const usageNote = img.usage === 0
        ? "noch nie genutzt"
        : `zuletzt benutzt: vor ${img.days} Tagen, insgesamt ${img.usage}x`;
      const herkunft = img.is_ai ? "KI-BILD" : "ECHTES FOTO";
      return `[${i + 1}] id=${img.id} [${herkunft}] (${usageNote})\n  Beschreibung: ${desc}\n  Kategorien: ${cats}`;
    })
    .join("\n\n");

  const systemPrompt = "Du bist Bild-Redakteur. Entscheide welche vorhandenen Fotos zu einem Blog-Artikel passen. Sorge fuer Abwechslung im Blog: bevorzuge Bilder die schon laenger nicht mehr genutzt wurden.";
  const userPrompt = `ARTIKEL:
Titel: "${article.title}"
Kategorie: ${plan.categoryLabel}
Keyword: ${seo.primaryKeyword}
Thema/Angle: ${plan.angleName}

VERFUEGBARE REFERENZBILDER (mit Nutzungs-Historie):
${imageList}

Entscheide:
1. img1 (Titelbild): Welches Bild passt am besten zum Artikel?
2. img2 (Artikel-Innenbild): Welches ANDERE Bild passt? Darf dasselbe sein wenn nur eines wirklich passt.

Regeln:
- ECHTE FOTOS haben IMMER Vorrang vor KI-BILDERN — ein passendes echtes Foto schlaegt jedes KI-Bild, auch ein kuerzlich genutztes.
- Bevorzuge Bilder die schon laenger nicht mehr genutzt wurden.
- Vermeide Bilder die in den letzten 14 Tagen verwendet wurden, ausser sie passen perfekt zum Thema.
- Streng urteilen: Nur waehlen wenn Beschreibung/Kategorie wirklich passt.
- Wenn keins passt -> null ausgeben.

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

    let img1 = byId(sel.img1_id);
    let img2 = byId(sel.img2_id);

    // Fallback-Pass 1: wenn kein img1 gewaehlt, LLM mit gelockerten Kriterien nochmal befragen
    let relaxFailed = false;
    if (!img1 && usable.length > 0) {
      try {
        const relaxSystem = "Du bist Bild-Redakteur. Waehle pragmatisch ein verwendbares Foto aus dem Pool, auch wenn nicht perfekt thematisch.";
        const relaxUser = `ARTIKEL: "${article.title}" (Kategorie: ${plan.categoryLabel})\n\nPOOL:\n${imageList}\n\nWaehle das am wenigsten unpassende Bild als Titelbild. Bevorzuge Bilder die noch nie oder lange nicht genutzt wurden. Antworte NUR JSON: {"img1_id":"uuid"}`;
        const relaxRaw = await generateText(settings, relaxSystem, relaxUser);
        const relaxMatch = relaxRaw.match(/\{[\s\S]*?\}/);
        if (relaxMatch) {
          const relaxSel = JSON.parse(relaxMatch[0]);
          img1 = byId(relaxSel.img1_id);
        }
      } catch { relaxFailed = true; }
    }

    // Fallback-Pass 2: deterministischer LRU-Pick — NUR wenn der Relax-Call
    // technisch gescheitert ist. Ein doppeltes bewusstes "keins passt" wird
    // respektiert → Bild wird neu generiert statt unpassende Referenz zu
    // erzwingen (Audit 17.07.2026, Schutt-Fotos auf fremden Artikeln).
    if (!img1 && relaxFailed && usable.length > 0) {
      const sorted = [...usable].sort((a, b) => {
        if (Boolean(a.is_ai) !== Boolean(b.is_ai)) return a.is_ai ? 1 : -1;
        const ua = a.usage_count || 0, ub = b.usage_count || 0;
        if (ua !== ub) return ua - ub;
        const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return ta - tb;
      });
      img1 = sorted[0] || null;
    }

    // Usage-Tracking: unique IDs erhoehen (kein Doppelzaehlen wenn img1==img2)
    const usedIds = [...new Set([img1?.id, img2?.id].filter(Boolean))];
    if (usedIds.length > 0) {
      try {
        await query(
          `UPDATE tenant_reference_images
              SET usage_count = COALESCE(usage_count,0) + 1,
                  last_used_at = now()
            WHERE id = ANY($1::uuid[])`,
          [usedIds]
        );
      } catch (e) {
        // Tracking-Fehler darf Pipeline nicht killen
      }
    }

    // Stil-Referenz: Wenn kein Foto DIREKT als Titelbild passt, aber ein echtes
    // (nicht-KI) Foto thematisch nah ist, geht es als Generier-Input an qwen-edit —
    // neue Szene im Look der echten Aufnahmen statt blinder Text-Generierung.
    // styleRef auch berechnen, wenn img1 direkt gewaehlt wurde — das
    // INNENBILD braucht die Foto-Referenz ebenfalls (22.07.2026: img2 war
    // sonst der letzte rein KI-generierte Pfad).
    let styleRef = null;
    {
      const words = String(article.title || "").toLowerCase().replace(/[:,.!?]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
      let best = null;
      for (const img of scored) {
        if (img.is_ai) continue;
        const text = `${img.description || ""} ${(Array.isArray(img.categories) ? img.categories.join(" ") : img.categories) || ""}`.toLowerCase();
        const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
        if (score >= 1 && (!best || score > best.score || (score === best.score && img.usage < best.img.usage))) {
          best = { score, img };
        }
      }
      if (best) styleRef = best.img;
    }

    return { img1, img2, styleRef };
  } catch {
    return { img1: null, img2: null, styleRef: null };
  }
}
