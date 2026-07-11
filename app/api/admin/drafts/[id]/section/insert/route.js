import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadTenant } from "@/lib/pipeline/index";
import { generateText } from "@/lib/providers/text";
import {
  getDraftPost,
  postPayload,
  splitSections,
  joinSections,
  sanitizeArticleHtml,
  stripCodeFence,
  htmlToText,
  buildTenantVoice,
  saveBlogBody,
} from "../../../_lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/drafts/[id]/section/insert
 * Body: { afterIdx: number, html?: string, prompt?: string }
 * Fuegt NACH Sektion afterIdx eine neue Sektion ein (afterIdx=-1 → an den Anfang).
 * Entweder fertiges html (wird sanitized) ODER prompt → KI erzeugt die Sektion
 * ueber den Tenant-Provider. Persistiert und liefert post + sections + new_idx.
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

  const afterIdx = Number.parseInt(body?.afterIdx, 10);
  if (Number.isNaN(afterIdx) || afterIdx < -1) {
    return NextResponse.json({ ok: false, error: "invalid_afterIdx" }, { status: 400 });
  }

  const rawHtml = typeof body?.html === "string" ? body.html.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawHtml && prompt.length < 3) {
    return NextResponse.json({ ok: false, error: "html_or_prompt_required" }, { status: 400 });
  }

  const post = await getDraftPost(params.id);
  if (!post) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const sections = splitSections(post.blog_body || "");
  // Einfuegeposition: nach afterIdx, auf [0..sections.length] geklemmt.
  const pos = Math.max(0, Math.min(afterIdx + 1, sections.length));

  let sectionHtml = rawHtml;
  if (!sectionHtml) {
    let tenant, settings, profile;
    try {
      ({ tenant, settings, profile } = await loadTenant(post.tenant_id));
    } catch (e) {
      return NextResponse.json({ ok: false, error: "tenant_load_failed", detail: e.message }, { status: 500 });
    }

    const voice = buildTenantVoice(tenant, profile);
    const lang = post.language || "de";
    const langName = lang === "de" ? "Deutsch (Umlaute ä/ö/ü/ß Pflicht)" : lang;
    // Kontext = reiner Text der bestehenden Sektionen, auf ~1500 Zeichen gekappt.
    const context = htmlToText(sections.map((s) => s.html).join(" ")).replace(/\s+/g, " ").slice(0, 1500);

    const system =
      `Du bist SEO-Texter für ${voice.company}. Tonalität: ${voice.brandVoice}. ` +
      (voice.contextLine ? voice.contextLine + " " : "") +
      "Erzeuge EINE neue, eigenständige Blog-Sektion in HTML. " +
      "Beginne mit einer <h2>-Überschrift, danach <p>-Absätze und optional <ul>/<ol> mit <li>. " +
      "Antworte NUR mit sauberem HTML-Fragment: keine Markdown-Codeblöcke, keine Erklärung, " +
      "kein <html>, kein <head>, kein <body>, keine <script>-Tags. " +
      `Sprache: ${langName}. ` +
      "Passe Ton und Thema an den restlichen Artikel an, ohne bestehende Aussagen zu wiederholen. " +
      voice.hardRules;

    const user =
      `Artikel-Titel: ${post.blog_title || ""}\n` +
      `Primärkeyword: ${post.blog_primary_keyword || "—"}\n` +
      `Sprache: ${lang}\n\n` +
      `KONTEXT (bestehender Artikel, gekürzt):\n${context}\n\n` +
      `AUFGABE (neue Sektion):\n${prompt}\n\n` +
      "Gib <h2>Überschrift</h2> gefolgt von <p>/<ul> zurück.";

    try {
      sectionHtml = await generateText(settings, system, user);
    } catch (e) {
      return NextResponse.json({ ok: false, error: "llm_failed", detail: e.message }, { status: 502 });
    }
  }

  const safeHtml = sanitizeArticleHtml(stripCodeFence(sectionHtml));
  if (!safeHtml) return NextResponse.json({ ok: false, error: "empty_section" }, { status: 502 });

  const next = sections.map((s) => s.html);
  next.splice(pos, 0, safeHtml);
  const fresh = await saveBlogBody(params.id, joinSections(next));

  return NextResponse.json({
    ok: true,
    post: postPayload(fresh),
    sections: splitSections(fresh?.blog_body || ""),
    new_idx: pos,
  });
}
