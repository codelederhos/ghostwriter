/**
 * POST /api/tenants/[id]/images/analyze
 * Analysiert Referenzbilder mit Claude Vision.
 * Generiert detaillierte Beschreibungen + Raumtyp + Zustand + Tags.
 */
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANALYZE_PROMPT = `Du analysierst ein Immobilienfoto für ein Maklerunternehmen.

Antworte NUR mit einem JSON-Objekt (kein Markdown, keine Erklärung):
{
  "description": "Präzise Beschreibung des Bildes in 1-2 Sätzen auf Deutsch. Was ist zu sehen? Welcher Raum/Bereich? Welcher Zustand?",
  "room_type": "Eines von: Wohnzimmer | Küche | Bad | Schlafzimmer | Kinderzimmer | Flur | Keller | Dachgeschoss | Außenansicht | Garten | Büro | Garage | Mehrfamilienhaus | Wohngebäude | Gewerbe | Grundstück | Sonstiges",
  "condition_tag": "Eines von: vorher | nachher | neutral",
  "tags": ["max 5 relevante Stichworte auf Deutsch, z.B. Parkett, Tageslicht, Renovierungsbedarf, Balkon, offene Küche, Altbau, Neubau, Dachterrasse"]
}

Hinweise:
- "vorher": sichtbarer Renovierungsbedarf, veraltete Ausstattung, Baustelle, leer/unrenoviert
- "nachher": frisch renoviert, moderne Ausstattung, ansprechend hergerichtet
- "neutral": Außenaufnahme, Grundriss, kann beides sein`;

async function analyzeImage(imageUrl, imageId) {
  // Bild von der lokalen URL laden
  let imageData;
  let mediaType = "image/jpeg";

  try {
    if (imageUrl.startsWith("http")) {
      // Absolute URL → fetch
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      imageData = Buffer.from(buf).toString("base64");
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("png")) mediaType = "image/png";
      else if (ct.includes("webp")) mediaType = "image/webp";
    } else {
      // Relative URL → lokal lesen
      const filePath = path.join(process.cwd(), "public", imageUrl);
      imageData = fs.readFileSync(filePath).toString("base64");
      if (imageUrl.endsWith(".png")) mediaType = "image/png";
      else if (imageUrl.endsWith(".webp")) mediaType = "image/webp";
    }
  } catch (err) {
    // Fallback: Thumbnail probieren
    throw new Error(`Bild nicht ladbar: ${err.message}`);
  }

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
        { type: "text", text: ANALYZE_PROMPT }
      ]
    }]
  });

  const text = msg.content[0].text.trim();
  // JSON aus Antwort extrahieren
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Kein JSON in Antwort: ${text}`);
  return JSON.parse(jsonMatch[0]);
}

// ─── POST: Einzel-Bild synchron analysieren ODER Batch starten ───────────────
export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json().catch(() => ({}));

  // Einzel-Bild-Modus: imageId angegeben → synchron, gibt Ergebnis zurück
  if (body.imageId) {
    const { rows: [img] } = await query(
      `SELECT id, image_url, thumb_url FROM tenant_reference_images WHERE id = $1 AND tenant_id = $2`,
      [body.imageId, id]
    );
    if (!img) return NextResponse.json({ error: "Bild nicht gefunden" }, { status: 404 });
    try {
      const result = await analyzeImage(img.thumb_url || img.image_url, img.id);
      await query(
        `UPDATE tenant_reference_images
         SET description = $2, room_type = $3, condition_tag = $4, ai_tags = $5, ai_analyzed = true, categories = $6
         WHERE id = $1`,
        [img.id, result.description, result.room_type, result.condition_tag, result.tags || [], result.tags || []]
      );
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  const onlyUnanalyzed = body.onlyUnanalyzed !== false; // default: nur neue

  const { rows: images } = await query(
    `SELECT id, image_url, thumb_url FROM tenant_reference_images
     WHERE tenant_id = $1 AND type = 'post'
     ${onlyUnanalyzed ? "AND (ai_analyzed IS NULL OR ai_analyzed = false)" : ""}
     ORDER BY created_at DESC`,
    [id]
  );

  if (images.length === 0) {
    return NextResponse.json({ ok: true, total: 0, message: "Alle Bilder bereits analysiert" });
  }

  // Analyse-Status in DB markieren
  await query(
    `UPDATE tenant_settings SET drive_sync_status = 'analyzing', drive_sync_total = $2, drive_sync_done = 0 WHERE tenant_id = $1`,
    [id, images.length]
  );

  // Fire & Forget
  (async () => {
    let done = 0;
    for (const img of images) {
      try {
        // Thumbnail bevorzugen (kleiner, schneller)
        const urlToUse = img.thumb_url || img.image_url;
        const result = await analyzeImage(urlToUse, img.id);

        await query(
          `UPDATE tenant_reference_images
           SET description = $2, room_type = $3, condition_tag = $4, ai_tags = $5, ai_analyzed = true, categories = $6
           WHERE id = $1`,
          [
            img.id,
            result.description,
            result.room_type,
            result.condition_tag,
            result.tags || [],
            result.tags || [],
          ]
        );
      } catch (err) {
        console.error(`[Vision] Fehler bei ${img.id}:`, err.message);
        // Als analysiert markieren damit wir nicht ewig neu probieren
        await query(`UPDATE tenant_reference_images SET ai_analyzed = true WHERE id = $1`, [img.id]);
      }

      done++;
      await query(
        `UPDATE tenant_settings SET drive_sync_done = $2 WHERE tenant_id = $1`,
        [id, done]
      );
    }

    await query(
      `UPDATE tenant_settings SET drive_sync_status = 'done', drive_sync_done = $2 WHERE tenant_id = $1`,
      [id, images.length]
    );
    console.log(`[Vision] ${id}: ${images.length} Bilder analysiert`);
  })().catch(console.error);

  return NextResponse.json({ ok: true, total: images.length, started: true });
}

// ─── GET: Analyse-Status ──────────────────────────────────────────────────────
export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { rows: [settings] } = await query(
    `SELECT drive_sync_status, drive_sync_total, drive_sync_done FROM tenant_settings WHERE tenant_id = $1`,
    [id]
  );
  const { rows: [counts] } = await query(
    `SELECT COUNT(*) total, COUNT(*) FILTER (WHERE ai_analyzed = true) analyzed
     FROM tenant_reference_images WHERE tenant_id = $1 AND type = 'post'`,
    [id]
  );

  return NextResponse.json({
    status: settings?.drive_sync_status || "idle",
    total: parseInt(counts?.total || 0),
    analyzed: parseInt(counts?.analyzed || 0),
    syncDone: settings?.drive_sync_done || 0,
    syncTotal: settings?.drive_sync_total || 0,
  });
}
