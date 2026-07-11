import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadTenant } from "@/lib/pipeline/index";
import { generateText } from "@/lib/providers/text";
import {
  getDraftPost,
  splitSections,
  sanitizeArticleHtml,
  stripCodeFence,
  buildTenantVoice,
} from "../../../../_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/drafts/[id]/section/[idx]/regenerate
 * Body: { wish: string }
 * Schreibt die Sektion per KI neu (Tenant-Provider via loadTenant + generateText,
 * Systemprompt aus dem Tenant-Profil). Persistiert NICHT — liefert nur
 * new_html/old_html, der Client bestaetigt und speichert dann via PATCH section.
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
  const wish = String(body?.wish || "").trim();
  if (!wish) return NextResponse.json({ ok: false, error: "wish_required" }, { status: 400 });

  const idx = Number.parseInt(params.idx, 10);
  if (Number.isNaN(idx) || idx < 0) {
    return NextResponse.json({ ok: false, error: "invalid_idx" }, { status: 400 });
  }

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const sections = splitSections(post.blog_body || "");
  if (idx >= sections.length) {
    return NextResponse.json({ ok: false, error: "section_out_of_range", max: sections.length - 1 }, { status: 400 });
  }
  const current = sections[idx];

  let tenant, settings, profile;
  try {
    ({ tenant, settings, profile } = await loadTenant(post.tenant_id));
  } catch (e) {
    return NextResponse.json({ ok: false, error: "tenant_load_failed", detail: e.message }, { status: 500 });
  }

  const voice = buildTenantVoice(tenant, profile);
  const lang = post.language || "de";
  const langName = lang === "de" ? "Deutsch (Umlaute ä/ö/ü/ß Pflicht)" : lang;

  const system =
    `Du bist SEO-Texter für ${voice.company}. Tonalität: ${voice.brandVoice}. ` +
    (voice.contextLine ? voice.contextLine + " " : "") +
    "Schreibe EINE Blog-Sektion in HTML neu. " +
    "STRIKT: Behalte die HTML-Struktur (h2, h3, p, ul, ol, li, strong, table) bei. " +
    "Antworte NUR mit sauberem HTML-Fragment: keine Markdown-Codeblöcke, keine Erklärung, " +
    "kein <html>, kein <head>, kein <body>, keine <script>-Tags. " +
    `Sprache: ${langName}. ` +
    voice.hardRules;

  const user =
    `Artikel-Titel: ${post.blog_title || ""}\n` +
    `Primärkeyword: ${post.blog_primary_keyword || "—"}\n` +
    `Sprache: ${lang}\n\n` +
    `AKTUELLE SEKTION (idx=${idx}):\n${current.html}\n\n` +
    `ÄNDERUNGSWUNSCH DES REDAKTEURS:\n${wish}\n\n` +
    "Gib NUR das neue HTML der Sektion zurück (mit <h2>, falls ursprünglich vorhanden).";

  let newHtml;
  try {
    newHtml = await generateText(settings, system, user);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "llm_failed", detail: e.message }, { status: 502 });
  }

  newHtml = sanitizeArticleHtml(stripCodeFence(newHtml));
  if (!newHtml) return NextResponse.json({ ok: false, error: "empty_result" }, { status: 502 });

  return NextResponse.json({ ok: true, new_html: newHtml, old_html: current.html });
}
