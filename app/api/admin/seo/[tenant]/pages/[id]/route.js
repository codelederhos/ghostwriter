export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenant, id } = params;
  const { rows: [t] } = await query("SELECT id FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows: [page] } = await query(
    `SELECT p.*, l.name->>'de' AS location_name, l.local_spots,
            pt.slug_template, pt.category, pt.ki_style_sample, pt.min_words
     FROM seo_pages p
     JOIN seo_locations l ON l.id = p.location_id
     JOIN seo_page_types pt ON pt.id = p.page_type_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [id, t.id]
  );
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows: [diag] } = await query(
    "SELECT * FROM seo_page_diagnostics WHERE page_id = $1", [id]
  );

  const { rows: metrics30 } = await query(
    `SELECT date, gsc_impressions, gsc_clicks, gsc_ctr, gsc_position,
            ana_sessions, ana_bounces, ana_cta_clicks, ana_cta_breakdown
     FROM seo_page_metrics WHERE page_id = $1
     AND date >= CURRENT_DATE - 30 ORDER BY date DESC`,
    [id]
  );

  const { rows: topQueryRows } = await query(
    `SELECT jsonb_array_elements(gsc_top_queries) AS q
     FROM seo_page_metrics
     WHERE page_id = $1 AND date >= CURRENT_DATE - 7`,
    [id]
  );

  const qMap = new Map();
  for (const row of topQueryRows) {
    const q = row.q;
    if (!q?.query) continue;
    if (!qMap.has(q.query)) qMap.set(q.query, { query: q.query, impressions: 0, clicks: 0, position: 0, count: 0 });
    const e = qMap.get(q.query);
    e.impressions += q.impressions || 0;
    e.clicks += q.clicks || 0;
    e.position += q.position || 0;
    e.count++;
  }
  const topQueries = [...qMap.values()]
    .map(q => ({ ...q, position: q.count > 0 ? (q.position / q.count).toFixed(1) : 0 }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  return NextResponse.json({ page, diagnostics: diag || null, metrics: metrics30, topQueries });
}

export async function POST(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenant, id } = params;
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  const { rows: [t] } = await query("SELECT id FROM tenants WHERE slug = $1", [tenant]);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Publish
  if (action === "publish") {
    await query(
      "UPDATE seo_pages SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2",
      [id, t.id]
    );
    return NextResponse.json({ ok: true });
  }

  if (action !== "regenerate") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Regenerate
  const { rows: [page] } = await query(
    `SELECT p.*, l.name->>'de' AS location_name, l.local_spots,
            pt.slug_template, pt.ki_style_sample, pt.min_words,
            ts.text_provider, ts.text_api_key, ts.text_model
     FROM seo_pages p
     JOIN seo_locations l ON l.id = p.location_id
     JOIN seo_page_types pt ON pt.id = p.page_type_id
     JOIN tenant_settings ts ON ts.tenant_id = p.tenant_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [id, t.id]
  );
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows: [diag] } = await query(
    "SELECT * FROM seo_page_diagnostics WHERE page_id = $1", [id]
  );

  const flags = [];
  if (diag?.flag_ctr_low)     flags.push("CTR unter Zielwert — Title + Meta Description überarbeiten");
  if (diag?.flag_bounce_high) flags.push("Bounce Rate hoch — Intro verbessern");
  if (diag?.flag_no_cta)      flags.push("Kaum CTA-Klicks — CTA-Platzierung überarbeiten");
  if (diag?.flag_not_indexed) flags.push("Seite nicht indexiert — mehr orts-spezifische Details");
  if (diag?.flag_keyword_gap) flags.push("Keywords aus GSC fehlen im Content");

  const gaps = (diag?.keyword_gaps || []).slice(0, 5).map(
    g => `"${g.query}" (${g.impressions} Impressionen, fehlt im Text)`
  );

  const locationName = typeof page.location_name === "object"
    ? (page.location_name?.de || page.location_name)
    : page.location_name;

  const localSpots = page.local_spots?.[page.lang] || page.local_spots?.de || [];

  const ctaUrl = page.lang === "ro" ? "/cerere" : "/kontakt";
  const ctaLabel = page.lang === "ro" ? "Solicită o programare" : "Jetzt anfragen";

  const prompt = `Du bist SEO-Texter und Bootstrap-5-Frontend-Entwickler für Gabriela Lederhos Fotografie.
Gabriela ist eine warme, persönliche Fotografin. Stil: direkt, feminin, einladend. Kein akademischer Text.
Sprache: ${page.lang.toUpperCase()}. Gabriela spricht die Leserin mit "du/ihr" an.

SEITE: ${page.slug}
ORT: ${locationName}
SERVICE: ${page.slug_template}
LOKALE SPOTS (nutze diese für local_html): ${JSON.stringify(localSpots)}
GSC-KEYWORDS (einbauen wo passend): ${gaps.length ? gaps.join(", ") : "keine"}
DIAGNOSE: ${flags.length ? flags.join(", ") : "Erstgenerierung"}

AUFGABE: Erstelle 3 Bootstrap-5 HTML-Sektionen + Meta-Felder. KEIN Markdown, NUR valides HTML.

=== SECTION 1: intro_html ===
Aufbau:
1. Kurze persönliche Einleitung (1 lead-Satz mit <p class="lead">)
2. 3 Vorteile als Bootstrap-Karten:
<div class="row g-3 mt-2">
  <div class="col-md-4"><div class="p-4 bg-white shadow-sm rounded-4 h-100"><div class="fs-4 mb-2">📸</div><h3 class="h6 fw-semibold mb-1">Vorteil-Titel</h3><p class="mb-0 small text-muted">1-2 Sätze.</p></div></div>
  ... (3 Karten, verschiedene Emojis passend zum Service)
</div>
3. CTA-Button: <div class="mt-4"><a href="${ctaUrl}" class="btn btn-gaby">${ctaLabel}</a></div>

=== SECTION 2: local_html ===
Aufbau:
1. <h2 class="fw-semibold mb-3">Lieblingsorte für [Service] in [Ort]</h2>
2. 1 Satz Einleitung
3. Nutze die LOKALE SPOTS — jeder Spot wird eine Karte:
<div class="row g-3">
  <div class="col-md-4"><div class="p-4 bg-white shadow-sm rounded-4 h-100"><h3 class="h6 fw-semibold mb-1">Spot-Name</h3><p class="mb-0 small text-muted">Warum gut für diesen Service? 2 Sätze.</p></div></div>
</div>
4. Falls weniger als 3 Spots: erfinde passende Orte für ${locationName}.

=== SECTION 3: practical_html ===
Aufbau:
1. <h2 class="fw-semibold mb-3">So läuft dein Shooting ab</h2>
2. 4 Schritte als nummerierte Karten:
<div class="row g-3">
  <div class="col-md-6"><div class="p-4 bg-white shadow-sm rounded-4 h-100 d-flex gap-3"><span class="fw-bold text-gaby fs-4">01</span><div><h3 class="h6 fw-semibold mb-1">Schritt-Titel</h3><p class="mb-0 small text-muted">1-2 Sätze.</p></div></div></div>
  ... (4 Schritte)
</div>
3. Reassurance-Box:
<div class="mt-4 p-4 rounded-4" style="background:#fdf6f0"><p class="mb-0 small">💬 Beruhigender Satz für Eltern / Kunden.</p></div>
4. CTA: <div class="mt-4 d-flex gap-3 flex-wrap"><a href="${ctaUrl}" class="btn btn-gaby">${ctaLabel}</a><a href="/preise" class="btn btn-gaby-outline">Preise ansehen</a></div>

=== FAQ ===
4 relevante Fragen zum Service in ${locationName}. Konkret und hilfreich.

Antworte NUR mit diesem JSON, absolut kein anderer Text davor oder danach:
{
  "title": "Service in Ort | Gabriela Lederhos Fotografie — max 60 Zeichen",
  "h1": "Service in Ort — emotionaler Untertitel — max 65 Zeichen",
  "meta_description": "Kurze Beschreibung mit Keyword + Ort + CTA — max 155 Zeichen",
  "intro_html": "...",
  "local_html": "...",
  "practical_html": "...",
  "faq_json": [{"q":"...","a":"..."}, {"q":"...","a":"..."}, {"q":"...","a":"..."}, {"q":"...","a":"..."}]
}`;

  let generated = null;
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://openclaw-ollama:11434/v1";
    let text = "";

    // Primär: Ollama qwen3.5:397b-cloud
    const r = await fetch(ollamaUrl + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.5:397b-cloud",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    text = d?.choices?.[0]?.message?.content || "";
    // <think>-Tags entfernen (qwen3 reasoning)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // JSON aus Antwort extrahieren
    const tick = String.fromCharCode(96);
    const stripped = text
      .replaceAll(tick + tick + tick + "json", "")
      .replaceAll(tick + tick + tick, "")
      .trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { generated = JSON.parse(match[0]); } catch (_) { generated = null; }
    }
  } catch (e) {
    return NextResponse.json({ error: "KI-Fehler: " + e.message }, { status: 500 });
  }

  if (!generated) {
    return NextResponse.json({ error: "KI hat kein valides JSON geliefert" }, { status: 500 });
  }

  await query(
    `UPDATE seo_pages SET
       title = $2, h1 = $3, meta_description = $4,
       intro_html = $5, local_html = $6, practical_html = $7, faq_json = $8,
       status = 'review', ki_generated_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      generated.title, generated.h1, generated.meta_description,
      generated.intro_html, generated.local_html, generated.practical_html,
      JSON.stringify(generated.faq_json || []),
    ]
  );

  return NextResponse.json({ ok: true, preview: generated });
}
