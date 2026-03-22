import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { generateText } from "@/lib/providers/text";

export const dynamic = "force-dynamic";

const FIELD_SPECS = {
  blog_title_tag: {
    targetMin: 50, targetMax: 60,
    hint: "Schreibe einen präzisen SEO-Title-Tag. Exakt 50-60 Zeichen. Keyword zuerst. Kein Firmenname am Ende nötig. Nur den Title-Tag selbst ausgeben, keine Anführungszeichen.",
  },
  blog_meta_description: {
    targetMin: 145, targetMax: 160,
    hint: "Schreibe eine überzeugende Meta Description. Exakt 145-160 Zeichen. Enthält das Keyword natürlich. Endet mit einem CTA-Impuls. Nur die Description selbst ausgeben, keine Anführungszeichen.",
  },
  gbp_text: {
    targetMin: 150, targetMax: 270,
    hint: "Schreibe einen Google Business Post Text. Maximal 270 Zeichen (HARTE GRENZE). Kurz, prägnant, lokal relevant, mit Call-to-Action. Nur den Text selbst ausgeben, keine Anführungszeichen.",
  },
  social_text: {
    targetMin: 300, targetMax: 800,
    hint: "Schreibe einen Social Media Post (Instagram/Facebook/LinkedIn). 300-800 Zeichen. Emotional, storytelling-orientiert, mit Mehrwert für den Leser. Darf Emojis enthalten. Endet mit einem CTA und ggf. Hashtags. Nur den Text selbst ausgeben, keine Anführungszeichen.",
  },
};

export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = params;
  const { field, context } = await req.json();

  if (!FIELD_SPECS[field]) {
    return NextResponse.json({ error: "Field not supported" }, { status: 400 });
  }

  // Load post + tenant
  const { rows: [post] } = await query(
    "SELECT tenant_id, blog_title, blog_primary_keyword, language FROM ghostwriter_posts WHERE id = $1",
    [postId]
  );
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const { rows: [settings] } = await query(
    "SELECT * FROM tenant_settings WHERE tenant_id = $1",
    [post.tenant_id]
  );
  if (!settings) return NextResponse.json({ error: "No tenant settings" }, { status: 500 });

  // Decrypt API key
  const decrypted = { ...settings };
  if (decrypted.text_api_key) {
    try { decrypted.text_api_key = decrypt(decrypted.text_api_key); } catch { /* leave as-is */ }
  }
  if (decrypted.billing_mode === "platform") {
    decrypted.text_api_key = process.env.ANTHROPIC_API_KEY;
    decrypted.text_provider = "anthropic";
  }

  const spec = FIELD_SPECS[field];
  const lang = post.language === "en" ? "English" : "Deutsch";
  const title = post.blog_title || "";
  const keyword = post.blog_primary_keyword || "";

  const systemPrompt = `Du bist ein SEO- und Content-Experte. Sprache: ${lang}. ${spec.hint}`;
  const userPrompt = `Artikel-Titel: "${title}"
Primary Keyword: "${keyword}"
${context?.currentValue ? `Aktueller Wert: "${context.currentValue}"` : ""}

Optimiere dieses Feld für maximale SEO-Wirkung und Klickrate.`;

  const optimized = await generateText(decrypted, systemPrompt, userPrompt);
  const trimmed = optimized.trim().replace(/^["']|["']$/g, "");

  return NextResponse.json({ value: trimmed });
}
