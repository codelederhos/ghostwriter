import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { generateText } from "@/lib/providers/text";

export const dynamic = "force-dynamic";

// HTML-Tags entfernen für sauberen Artikel-Text
function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const FIELD_SPECS = {
  blog_title_tag: {
    hint: "Erstelle einen SEO-Title-Tag basierend auf dem Artikel. Exakt 50-60 Zeichen. Keyword zuerst. Nur den Title-Tag ausgeben, keine Anführungszeichen.",
    useArticle: false,
  },
  blog_meta_description: {
    hint: "Erstelle eine Meta Description basierend auf dem Artikel. Exakt 145-160 Zeichen. Keyword natürlich eingebaut. Endet mit CTA-Impuls. Nur die Description ausgeben, keine Anführungszeichen.",
    useArticle: false,
  },
  gbp_text: {
    hint: "Fasse den Artikel als Google Business Post zusammen. Maximal 270 Zeichen (HARTE GRENZE). Prägnant, die wichtigste Aussage des Artikels, mit Call-to-Action. Keine erfundenen Geschichten. Nur den Text ausgeben.",
    useArticle: true,
  },
  social_text: {
    hint: "Fasse den Artikel als Social Media Post (Instagram/Facebook/LinkedIn) zusammen. Mindestens 800 Zeichen. Behalte den Stil und die Aussagen des Artikels bei — fasse zusammen, erfinde nichts Neues. Mehrere Absätze, natürlicher Ton. Darf wenige passende Emojis enthalten. Endet mit CTA und 3-5 Hashtags. Nur den Text ausgeben.",
    useArticle: true,
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

  const spec = FIELD_SPECS[field];

  // Load post + tenant (blog_body nur wenn gebraucht)
  const { rows: [post] } = await query(
    `SELECT tenant_id, blog_title, blog_primary_keyword, language${spec.useArticle ? ", blog_body" : ""} FROM ghostwriter_posts WHERE id = $1`,
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

  const lang = post.language === "en" ? "English" : "Deutsch";
  const articleText = spec.useArticle
    ? stripHtml(post.blog_body).slice(0, 4000)
    : null;

  const systemPrompt = `Du bist ein Content-Experte. Sprache: ${lang}. ${spec.hint}`;
  const userPrompt = articleText
    ? `Artikel-Titel: "${post.blog_title}"
Primary Keyword: "${post.blog_primary_keyword || ""}"

Artikel-Inhalt:
${articleText}`
    : `Artikel-Titel: "${post.blog_title}"
Primary Keyword: "${post.blog_primary_keyword || ""}"
${context?.currentValue ? `Aktueller Wert: "${context.currentValue}"` : ""}`;

  const optimized = await generateText(decrypted, systemPrompt, userPrompt);
  const trimmed = optimized.trim().replace(/^["']|["']$/g, "");

  return NextResponse.json({ value: trimmed });
}
