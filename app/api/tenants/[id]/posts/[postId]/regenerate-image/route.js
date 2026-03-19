import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto.js";
import { generateImage } from "@/lib/providers/image.js";

export const dynamic = "force-dynamic";

const DEFAULT_REGEN_PRICE = 100; // 1€

async function getRegenPrice() {
  const { rows } = await query("SELECT value FROM system_config WHERE key = 'pricing'");
  const pricing = rows[0]?.value || {};
  return pricing.image_regen_price_cents ?? DEFAULT_REGEN_PRICE;
}

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tenantId, postId } = params;

  // Post laden
  const { rows: [post] } = await query(
    "SELECT * FROM ghostwriter_posts WHERE id = $1 AND tenant_id = $2",
    [postId, tenantId]
  );
  if (!post) return NextResponse.json({ error: "Post nicht gefunden" }, { status: 404 });

  // Tenant-Settings laden
  const { rows: [settings] } = await query(
    "SELECT * FROM tenant_settings WHERE tenant_id = $1",
    [tenantId]
  );
  if (!settings) return NextResponse.json({ error: "Tenant-Settings fehlen" }, { status: 404 });

  const decrypted = { ...settings };
  if (decrypted.image_api_key) {
    try { decrypted.image_api_key = decrypt(decrypted.image_api_key); } catch { /* leave */ }
  }
  if (decrypted.billing_mode === "platform") {
    if (process.env.OPENAI_API_KEY) {
      decrypted.image_api_key = process.env.OPENAI_API_KEY;
      decrypted.image_provider = "dalle3";
    }
  }

  const costCents = await getRegenPrice();
  const slug = post.blog_slug || `post-${postId}`;

  // System-Config für Modell laden
  const { rows: sysRows } = await query(
    "SELECT key, value FROM system_config WHERE key = 'image_models'"
  );
  const imageModelsCfg = sysRows[0]?.value ? JSON.parse(sysRows[0].value) : {};
  if (!decrypted.image_model) {
    decrypted.image_model = imageModelsCfg.openai?.model || "gpt-image-1";
  }

  const style = decrypted.image_style_prefix || "Shot on Canon 5D Mark IV 35mm f/2.8, golden hour natural light, Kodak Portra 400 film grain, authentic atmosphere, no faces, no text, no logos, no CGI";
  // Fallback: Kein Blog-Titel als Prompt (würde Text ins Bild rendern) — stattdessen thematische Szene
  const rawPrompt = post.image_prompt_1
    || `Real estate scene, ${post.category || "Immobilien"} context, professional atmosphere, people interacting naturally with property documents or a building, warm light`;
  const prompt = `${style}. ${rawPrompt}`;

  try {
    const result = await generateImage(decrypted, prompt, `${slug}-regen`);

    // Post aktualisieren
    await query(
      "UPDATE ghostwriter_posts SET image_url = $1, image_alt_text = $2 WHERE id = $3",
      [result.url, post.image_alt_text || post.blog_title, postId]
    );

    // Regen-Kosten tracken
    if (settings.billing_mode === "platform") {
      await query(
        `INSERT INTO post_image_regenerations (post_id, tenant_id, cost_cents, image_url)
         VALUES ($1, $2, $3, $4)`,
        [postId, tenantId, costCents, result.url]
      );
    }

    return NextResponse.json({ ok: true, imageUrl: result.url, costCents });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
