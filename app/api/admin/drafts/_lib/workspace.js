/**
 * Gemeinsame Server-Helper fuer den zentralen Draft-Review-Workspace
 * (/api/admin/drafts/*). Portiert aus dem Baurimmo-Redaktions-Workspace:
 * Section-Split/Join an <h2>-Grenzen + serverseitiger HTML-Sanitizer.
 *
 * Kein Route-Segment (Ordner _lib) — wird nur von den Routen importiert.
 */

import { query } from "@/lib/db";
import { loadTenant } from "@/lib/pipeline/index";
import { generateText } from "@/lib/providers/text";

// ---------------------------------------------------------------- UUID-Guard

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID-Guard vor der DB, sonst wirft Postgres 500 statt sauberer 404. */
export function isDraftId(value) {
  return UUID_RE.test(String(value || ""));
}

// ------------------------------------------------------------- HTML-Sanitizer

/**
 * Serverseitiger Sanitizer fuer Section-/Artikel-HTML.
 * Entfernt: script/style/iframe/object/embed/form (inkl. Inhalt), Head-Tags,
 * <html>/<head>/<body>-Wrapper, HTML-Kommentare, on*-Attribute und
 * javascript:-URLs. Markdown-Codefences werden vorab weggeputzt.
 */
export function sanitizeArticleHtml(html) {
  let out = String(html || "");
  // Markdown-Codefence, falls ein Modell sich nicht an "nur HTML" haelt
  out = out.replace(/^```\w*\n?/m, "").replace(/\n?```\s*$/m, "");
  // Doctype + Dokument-Wrapper raus (Sections sind immer Fragmente)
  out = out.replace(/<!DOCTYPE[^>]*>/gi, "");
  out = out.replace(/<\/?(?:html|head|body)[^>]*>/gi, "");
  // Gefaehrliche Bloecke inkl. Inhalt
  out = out.replace(/<(script|style|iframe|object|embed|form|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Einzelne/selbstschliessende gefaehrliche Tags
  out = out.replace(/<\/?(?:script|style|iframe|object|embed|form|link|meta|base|noscript)\b[^>]*\/?>/gi, "");
  // HTML-Kommentare
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // on*-Event-Attribute (alle Quoting-Varianten)
  out = out.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*(?!["'])[^\s>]+/gi, "");
  // javascript:/vbscript:/data:text-URLs in href/src neutralisieren
  out = out.replace(/\s(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, ' $1="#"');
  return out.trim();
}

// ------------------------------------------------------ Section-Split / -Join

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sectionTitle(chunk, isIntro) {
  const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return stripTags(h2[1]) || "(ohne Titel)";
  const h3 = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3) return stripTags(h3[1]) || "(ohne Titel)";
  return isIntro ? "Einleitung" : "(ohne Titel)";
}

/**
 * Splittet blog_body an <h2>-Grenzen in editierbare Sektionen.
 * Der Teil vor dem ersten <h2> ist die Einleitung (eigene Sektion).
 * @returns {{ idx: number, title: string, html: string }[]}
 */
export function splitSections(html) {
  const src = String(html || "").trim();
  if (!src) return [];

  const starts = [];
  const re = /<h2[\s>]/gi;
  let m;
  while ((m = re.exec(src)) !== null) starts.push(m.index);

  const chunks = [];
  if (starts.length === 0) {
    chunks.push({ html: src, isIntro: true });
  } else {
    if (starts[0] > 0) chunks.push({ html: src.slice(0, starts[0]), isIntro: true });
    for (let i = 0; i < starts.length; i += 1) {
      chunks.push({ html: src.slice(starts[i], starts[i + 1] ?? src.length), isIntro: false });
    }
  }

  return chunks
    .map((c) => ({ ...c, html: c.html.trim() }))
    .filter((c) => c.html.length > 0)
    .map((c, idx) => ({ idx, title: sectionTitle(c.html, c.isIntro), html: c.html }));
}

/** Setzt den blog_body aus Sektionen (Strings oder {html}) neu zusammen. */
export function joinSections(sections) {
  return (sections || [])
    .map((s) => String(typeof s === "string" ? s : s?.html || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Ersetzt die Sektion idx im body-HTML und liefert den neuen Gesamt-Body. */
export function replaceSection(bodyHtml, idx, newSectionHtml) {
  const sections = splitSections(bodyHtml);
  if (idx < 0 || idx >= sections.length) {
    throw new Error(`Sektion ${idx} existiert nicht (0..${sections.length - 1})`);
  }
  const next = sections.map((s) => s.html);
  next[idx] = String(newSectionHtml || "").trim();
  return joinSections(next);
}

// ------------------------------------------------------------------ Text-Utils

export function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripCodeFence(value) {
  return String(value || "").replace(/^```\w*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------------ QA-Parsing

export function parseMaybeJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * qa_issues normalisieren: neues Gate-Objekt {score, checks[], status, ...}
 * ODER Legacy-Array von Strings → immer einheitliche Struktur fuer die UI.
 */
export function normalizeQa(qaIssues, qaScore) {
  const parsed = parseMaybeJson(qaIssues, null);

  if (Array.isArray(parsed)) {
    return {
      score: qaScore ?? null,
      status: null,
      autopublish_allowed: false,
      checks: [],
      issues: parsed.map((v) => (typeof v === "string" ? v : v?.message || JSON.stringify(v))),
      llmNote: null,
    };
  }

  if (parsed && typeof parsed === "object") {
    return {
      score: parsed.score ?? qaScore ?? null,
      status: parsed.status || parsed.gate_status || null,
      autopublish_allowed: parsed.autopublish_allowed === true,
      checks: Array.isArray(parsed.checks) ? parsed.checks : [],
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((v) => (typeof v === "string" ? v : v?.message || JSON.stringify(v)))
        : [],
      llmNote: parsed.llmNote || null,
    };
  }

  return { score: qaScore ?? null, status: null, autopublish_allowed: false, checks: [], issues: [], llmNote: null };
}

// --------------------------------------------------------------- Post laden

/** Draft-Post inkl. Tenant-Name/-Slug + gbp_enabled laden (oder null). */
export async function getDraftPost(id) {
  if (!isDraftId(id)) return null;
  const { rows: [post] } = await query(
    `SELECT gp.*,
            t.name AS tenant_name, t.slug AS tenant_slug,
            ts.gbp_enabled,
            COALESCE(ts.review_flow, 'core') AS review_flow
     FROM ghostwriter_posts gp
     JOIN tenants t ON t.id = gp.tenant_id
     LEFT JOIN tenant_settings ts ON ts.tenant_id = gp.tenant_id
     WHERE gp.id = $1`,
    [id]
  );
  return post || null;
}

/** Einheitliches Post-Payload fuer die UI (qa + social_text geparst, keine Token-Spalten). */
export function postPayload(post) {
  if (!post) return null;
  const social = parseMaybeJson(post.social_text, {}) || {};
  return {
    id: post.id,
    tenant_id: post.tenant_id,
    tenant_name: post.tenant_name || null,
    tenant_slug: post.tenant_slug || null,
    gbp_enabled: post.gbp_enabled === true,
    review_flow: post.review_flow || "core",
    language: post.language,
    category: post.category,
    angle: post.angle,
    season: post.season,
    status: post.status,
    is_test: post.is_test === true,
    blog_title: post.blog_title,
    blog_slug: post.blog_slug,
    blog_title_tag: post.blog_title_tag,
    blog_meta_description: post.blog_meta_description,
    blog_primary_keyword: post.blog_primary_keyword,
    blog_body: post.blog_body,
    blog_url: post.blog_url,
    image_url: post.image_url,
    image_alt_text: post.image_alt_text,
    gbp_text: post.gbp_text,
    social_text: typeof social === "object" && social ? social : {},
    qa_score: post.qa_score,
    qa: normalizeQa(post.qa_issues, post.qa_score),
    error_message: post.error_message || null,
    review_publish_error: post.review_publish_error || null,
    reviewed_at: post.reviewed_at || null,
    published_at: post.published_at || null,
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

/** blog_body aktualisieren und den frischen Post (inkl. Joins) zurueckliefern. */
export async function saveBlogBody(id, newBody) {
  await query(
    "UPDATE ghostwriter_posts SET blog_body = $2, updated_at = NOW() WHERE id = $1",
    [id, newBody]
  );
  return getDraftPost(id);
}

// -------------------------------------------------- KI-Systemprompt (Tenant)

/**
 * Systemprompt-Basis aus dem Tenant-Profil (brand voice etc.) ableiten.
 * Wird von section/regenerate, section/insert und social/regenerate benutzt.
 */
export function buildTenantVoice(tenant, profile) {
  const company = profile?.company_name || tenant?.name || "das Unternehmen";
  const brandVoice = profile?.brand_voice || "professionell aber nahbar";
  const facts = [
    profile?.industry ? `Branche: ${profile.industry}` : null,
    profile?.region ? `Region: ${profile.region}` : null,
    profile?.positioning ? `Positionierung: ${profile.positioning}` : null,
    profile?.usp ? `USP: ${profile.usp}` : null,
    profile?.services ? `Leistungen: ${String(profile.services).slice(0, 300)}` : null,
  ].filter(Boolean).join(" | ");

  return {
    company,
    brandVoice,
    contextLine: facts ? `Unternehmenskontext: ${facts}.` : "",
    hardRules:
      "HARTE REGELN: Deutsche Umlaute IMMER korrekt (ä, ö, ü, ß), niemals ae/oe/ue/ss. " +
      "KEIN Gedankenstrich (—, –), stattdessen Doppelpunkt oder Komma. " +
      "Kein KI-Sprech, keine Floskeln, sachlich, professionell, konkret. " +
      "Erfinde keine Zahlen oder Fakten.",
  };
}

// -------------------------------------------------- Sektion per KI neu schreiben

/** Fehler mit Maschinen-Code (Routen mappen ihn auf HTTP-Status). */
function codedError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Schreibt EINE Sektion (Split an <h2>-Grenzen, siehe splitSections) per KI neu.
 * Gemeinsame Logik fuer die Admin-Regenerate-Route (liefert nur Vorschlag,
 * kein Persist) und die oeffentliche Review-Route (persistiert direkt).
 *
 * Persistiert NICHT — die aufrufende Route entscheidet, was mit newHtml passiert.
 *
 * @param {object} post  ghostwriter_posts-Row (mind. tenant_id, blog_body, blog_title, language)
 * @param {number} idx   Sektions-Index wie splitSections (0 = Intro vor erstem <h2>, falls vorhanden)
 * @param {string} wish  Änderungswunsch des Redakteurs
 * @returns {Promise<{newHtml: string, oldHtml: string, sectionCount: number}>}
 * @throws Error mit .code: section_out_of_range | tenant_load_failed | llm_failed | empty_result
 */
export async function regenerateSectionHtml(post, idx, wish) {
  const sections = splitSections(post.blog_body || "");
  if (!Number.isInteger(idx) || idx < 0 || idx >= sections.length) {
    throw codedError(
      "section_out_of_range",
      `Sektion ${idx} existiert nicht (0..${sections.length - 1})`,
      { max: sections.length - 1 }
    );
  }
  const current = sections[idx];

  let tenant, settings, profile;
  try {
    ({ tenant, settings, profile } = await loadTenant(post.tenant_id));
  } catch (e) {
    throw codedError("tenant_load_failed", e.message);
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
    voice.hardRules + " " +
    // Zusatzregeln (schärfer als hardRules, gelten für die Sektions-Regeneration):
    "ZUSATZREGELN: Deutsche Rechtschreibung mit ß, wo sie hingehört (z.B. groß, Maß). " +
    "KEINE Doppelpunkt-Einschübe als Gedankenstrich-Ersatz (also nicht 'Das Ergebnis: mehr Umsatz' " +
    "als Stilmittel mitten im Satz), stattdessen vollständige Sätze oder Kommas. " +
    "Erfinde KEINE Firmen-Fakten, Angebote, Leistungen oder Preise, die nicht im Kontext stehen.";

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
    throw codedError("llm_failed", e.message);
  }

  newHtml = sanitizeArticleHtml(stripCodeFence(newHtml));
  if (!newHtml) throw codedError("empty_result", "KI hat ein leeres Ergebnis geliefert");

  return { newHtml, oldHtml: current.html, sectionCount: sections.length };
}
