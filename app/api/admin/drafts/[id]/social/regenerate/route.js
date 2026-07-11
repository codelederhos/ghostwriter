import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadTenant } from "@/lib/pipeline/index";
import { generateText } from "@/lib/providers/text";
import {
  getDraftPost,
  parseMaybeJson,
  htmlToText,
  stripCodeFence,
  buildTenantVoice,
} from "../../../_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PLATFORMS = ["linkedin", "facebook", "instagram", "gbp"];

const PLATFORM_LABEL = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google-Business-Profil",
};

// Laengen-Limits pro Plattform (Zeichen)
const MAX_CHARS = { linkedin: 1300, facebook: 800, instagram: 1000, gbp: 300 };

const PLATFORM_INSTRUCTION = {
  linkedin:
    "Schreibe einen LinkedIn-Post im Experten-Ton: fachlich fundiert, 3 bis 5 kurze Absätze, " +
    "starker Hook in den ersten 2 Zeilen, ein klarer Kerngedanke, dezenter Call-to-Action am Ende. " +
    "Maximal 3 passende Hashtags am Ende. Maximal 1300 Zeichen.",
  facebook:
    "Schreibe einen nahbaren Facebook-Post: lockerer als LinkedIn, aber seriös, konkreter Mehrwert " +
    "in 2 bis 3 Sätzen, dann klarer Call-to-Action. 1 bis 2 passende Emojis erlaubt (sparsam). " +
    "Maximal 800 Zeichen.",
  instagram:
    "Schreibe einen Instagram-Text im Hook-Stil: starke erste Zeile, danach 2 bis 4 knackige Punkte, " +
    "am Ende ein Call-to-Action. Wenige passende Hashtags am Ende. Maximal 1000 Zeichen.",
  gbp:
    "Schreibe einen Google-Business-Profil-Post: kompakt, lokal, mit klarem Call-to-Action " +
    "(z. B. Kontakt oder Beratung). Keine Hashtags. Maximal 300 Zeichen.",
};

// An Satzgrenze kuerzen, falls das Modell das Limit reisst.
function clip(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
  if (lastEnd > max * 0.6) return cut.slice(0, lastEnd + 1).trim();
  return cut.slice(0, max - 1).trimEnd() + "…";
}

/**
 * POST /api/admin/drafts/[id]/social/regenerate
 * Body: { platform: "linkedin"|"facebook"|"instagram"|"gbp", wish?: string }
 * Schreibt den Plattform-Text per KI neu (Tenant-Provider + Tenant-Profil).
 * Persistiert NICHT — der Client uebernimmt den Vorschlag und speichert via PATCH social.
 */
export async function POST(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const platform = String(body?.platform || "").trim().toLowerCase();
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ ok: false, error: "invalid_platform", allowed: PLATFORMS }, { status: 400 });
  }
  const wish = String(body?.wish || "").trim();

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  let tenant, settings, profile;
  try {
    ({ tenant, settings, profile } = await loadTenant(post.tenant_id));
  } catch (e) {
    return NextResponse.json({ ok: false, error: "tenant_load_failed", detail: e.message }, { status: 500 });
  }

  const voice = buildTenantVoice(tenant, profile);
  const social = parseMaybeJson(post.social_text, {}) || {};
  const existing = platform === "gbp"
    ? String(post.gbp_text || "").trim()
    : String(social[platform] || "").trim();
  const articleText = htmlToText(post.blog_body).replace(/\s+/g, " ").slice(0, 1500);

  const system =
    `Du bist Social-Media-Redakteur für ${voice.company}. Tonalität: ${voice.brandVoice}. ` +
    (voice.contextLine ? voice.contextLine + " " : "") +
    `Schreibe EINEN ${PLATFORM_LABEL[platform]}-Post passend zum Blogartikel. ` +
    "Sprache: Deutsch (Umlaute ä/ö/ü/ß Pflicht). " +
    voice.hardRules + " " +
    "Schreibe KEINEN Link (wird automatisch angehängt). " +
    "Antworte NUR mit dem reinen Post-Text: ohne Markdown-Codeblöcke, ohne Vorrede, " +
    "ohne Anführungszeichen um den Text. " +
    PLATFORM_INSTRUCTION[platform];

  const user =
    `Artikel-Titel: ${post.blog_title || ""}\n` +
    `Primärkeyword: ${post.blog_primary_keyword || "—"}\n\n` +
    `ARTIKEL-KLARTEXT (gekürzt):\n${articleText}\n\n` +
    (existing ? `BESTEHENDER ${PLATFORM_LABEL[platform]}-TEXT:\n${existing}\n\n` : "") +
    (wish ? `ÄNDERUNGSWUNSCH DES REDAKTEURS:\n${wish}\n\n` : "") +
    `Gib NUR den fertigen ${PLATFORM_LABEL[platform]}-Post-Text zurück (maximal ${MAX_CHARS[platform]} Zeichen).`;

  let text;
  try {
    text = await generateText(settings, system, user);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "llm_failed", detail: e.message }, { status: 502 });
  }

  text = clip(stripCodeFence(text), MAX_CHARS[platform]);
  if (!text) return NextResponse.json({ ok: false, error: "empty_result" }, { status: 502 });

  return NextResponse.json({ ok: true, text, platform, max_chars: MAX_CHARS[platform] });
}
