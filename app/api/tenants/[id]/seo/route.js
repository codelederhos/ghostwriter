import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { generateSeoContent } from "@/lib/pipeline/steps/seo_writer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GENERATE_BATCH = 10;
const GENERATE_CONCURRENCY = 2;

async function generatePageContent(tenantId, pageId) {
  const { rows: [page] } = await query(
    "SELECT * FROM seo_pages WHERE id = $1 AND tenant_id = $2",
    [pageId, tenantId]
  );
  if (!page) {
    const error = new Error("Page not found");
    error.code = "page_not_found";
    throw error;
  }

  const [{ rows: [type] }, { rows: [loc] }, { rows: [profile] }, { rows: [ts] }, { rows: [diag] }] = await Promise.all([
    query("SELECT * FROM seo_page_types WHERE id = $1 AND tenant_id = $2", [page.page_type_id, tenantId]),
    query("SELECT * FROM seo_locations WHERE id = $1", [page.location_id]),
    query("SELECT * FROM tenant_profiles WHERE tenant_id = $1", [tenantId]),
    query("SELECT * FROM tenant_settings WHERE tenant_id = $1", [tenantId]),
    query("SELECT * FROM seo_page_diagnostics WHERE page_id = $1", [pageId]),
  ]);
  if (!type || !loc || !ts) throw new Error("SEO-Konfiguration unvollständig");

  const settings = { ...ts };
  for (const field of ["text_api_key", "image_api_key"]) {
    if (settings[field]) {
      try { settings[field] = decrypt(settings[field]); } catch { /* leave as-is */ }
    }
  }
  if (settings.billing_mode === "platform") {
    settings.text_api_key = process.env.ANTHROPIC_API_KEY;
    settings.text_provider = "anthropic";
  }

  const result = await generateSeoContent(settings, type, loc, page.lang, profile, page, diag);
  await query(
    `UPDATE seo_pages SET
      title = $2, h1 = $3, meta_description = $4,
      intro_html = $5, local_html = $6, practical_html = $7,
      faq_json = $8, schema_org = $9, image_alts = $10, internal_links = $11,
      word_count = $12, ki_generated_at = NOW(), status = 'review'
    WHERE id = $1 AND tenant_id = $13`,
    [pageId, result.title, result.h1, result.meta_description,
     result.intro_html, result.local_html, result.practical_html,
     JSON.stringify(result.faq_json), JSON.stringify(result.schema_org),
     JSON.stringify(result.image_alts), JSON.stringify(result.internal_links),
     result.word_count, tenantId]
  );
  return result;
}

// ── GET: SEO Hub Daten für einen Tenant ──────────────────────────────
export async function GET(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "overview";

  switch (view) {
    // Übersicht: Stats + Seiten mit Diagnose
    case "overview": {
      const [{ rows: pages }, { rows: types }, { rows: locations }] = await Promise.all([
        query(
          `SELECT sp.*,
            spt.slug_template, spt.category,
            sl.name as location_name, sl.state,
            spd.severity, spd.flag_not_indexed, spd.flag_ctr_low, spd.flag_near_page1,
            spd.flag_bounce_high, spd.flag_no_cta, spd.flag_position_drop, spd.flag_keyword_gap
          FROM seo_pages sp
          JOIN seo_page_types spt ON sp.page_type_id = spt.id
          JOIN seo_locations sl ON sp.location_id = sl.id
          LEFT JOIN seo_page_diagnostics spd ON spd.page_id = sp.id
          WHERE sp.tenant_id = $1
          ORDER BY sp.slug`,
          [id]
        ),
        query("SELECT * FROM seo_page_types WHERE tenant_id = $1 ORDER BY slug_template", [id]),
        query(
          `SELECT DISTINCT sl.* FROM seo_locations sl
           JOIN seo_pages sp ON sp.location_id = sl.id
           WHERE sp.tenant_id = $1
           ORDER BY sl.name->>'de'`,
          [id]
        ),
      ]);

      // Aggregate stats
      const stats = {
        total: pages.length,
        draft: pages.filter(p => p.status === "draft").length,
        review: pages.filter(p => p.status === "review").length,
        published: pages.filter(p => p.status === "published").length,
        noindex: pages.filter(p => p.status === "noindex").length,
        critical: pages.filter(p => p.severity === "critical").length,
        warn: pages.filter(p => p.severity === "warn").length,
        notIndexed: pages.filter(p => p.flag_not_indexed).length,
        nearPage1: pages.filter(p => p.flag_near_page1).length,
        languages: [...new Set(pages.map(p => p.lang))],
      };

      return NextResponse.json({ pages, types, locations, stats });
    }

    // Einzelne Seite mit Metriken
    case "page": {
      const pageId = searchParams.get("pageId");
      if (!pageId) return NextResponse.json({ error: "pageId required" }, { status: 400 });

      const [{ rows: [page] }, { rows: metrics }, { rows: [diag] }] = await Promise.all([
        query(
          `SELECT sp.*, spt.slug_template, spt.category, spt.ki_style_sample,
            sl.name as location_name, sl.state, sl.local_spots, sl.lat, sl.lng
          FROM seo_pages sp
          JOIN seo_page_types spt ON sp.page_type_id = spt.id
          JOIN seo_locations sl ON sp.location_id = sl.id
          WHERE sp.id = $1 AND sp.tenant_id = $2`,
          [pageId, id]
        ),
        query(
          "SELECT * FROM seo_page_metrics WHERE page_id = $1 ORDER BY date DESC LIMIT 30",
          [pageId]
        ),
        query("SELECT * FROM seo_page_diagnostics WHERE page_id = $1", [pageId]),
      ]);

      if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ page, metrics, diagnostics: diag || null });
    }

    // Page Types
    case "types": {
      const { rows } = await query("SELECT * FROM seo_page_types WHERE tenant_id = $1 ORDER BY slug_template", [id]);
      return NextResponse.json({ types: rows });
    }

    // Locations
    case "locations": {
      const { rows } = await query("SELECT * FROM seo_locations ORDER BY name->>'de'");
      return NextResponse.json({ locations: rows });
    }

    default:
      return NextResponse.json({ error: "Unknown view" }, { status: 400 });
  }
}

// ── POST: SEO Hub Actions ────────────────────────────────────────────
export async function POST(req, props) {
  const params = await props.params;
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json();
  const { action } = body;

  switch (action) {
    // ── Page Types ─────────────────────────────────────────────
    case "create_type": {
      const { slug_template, slug_per_lang, category, title_template, h1_template, desc_template, schema_type, ki_style_sample, min_words } = body;
      const { rows: [type] } = await query(
        `INSERT INTO seo_page_types (tenant_id, slug_template, slug_per_lang, category, title_template, h1_template, desc_template, schema_type, ki_style_sample, min_words)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [id, slug_template, slug_per_lang || {}, category, title_template, h1_template, desc_template, schema_type || "LocalBusiness", ki_style_sample, min_words || 700]
      );
      return NextResponse.json({ ok: true, type });
    }

    case "update_type": {
      const { typeId, ...fields } = body;
      const allowed = ["slug_template", "slug_per_lang", "category", "title_template", "h1_template", "desc_template", "schema_type", "ki_style_sample", "min_words", "active", "cta_positions", "internal_link_count"];
      const sets = [];
      const vals = [typeId];
      let i = 2;
      for (const field of allowed) {
        if (fields[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          vals.push(fields[field]);
        }
      }
      if (sets.length === 0) return NextResponse.json({ ok: true });
      await query(`UPDATE seo_page_types SET ${sets.join(", ")} WHERE id = $1`, vals);
      return NextResponse.json({ ok: true });
    }

    case "delete_type": {
      await query("DELETE FROM seo_page_types WHERE id = $1 AND tenant_id = $2", [body.typeId, id]);
      return NextResponse.json({ ok: true });
    }

    // ── Locations ──────────────────────────────────────────────
    case "create_location": {
      const { name, slug, state, country, lat, lng, population, distance_km, local_spots } = body;
      const { rows: [loc] } = await query(
        `INSERT INTO seo_locations (name, slug, state, country, lat, lng, population, distance_km, local_spots)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [name, slug, state, country || "DE", lat, lng, population, distance_km, local_spots]
      );
      return NextResponse.json({ ok: true, location: loc });
    }

    case "update_location": {
      const { locationId, ...fields } = body;
      const allowed = ["name", "slug", "state", "country", "lat", "lng", "population", "distance_km", "local_spots", "active"];
      const sets = [];
      const vals = [locationId];
      let i = 2;
      for (const field of allowed) {
        if (fields[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          vals.push(fields[field]);
        }
      }
      if (sets.length === 0) return NextResponse.json({ ok: true });
      await query(`UPDATE seo_locations SET ${sets.join(", ")} WHERE id = $1`, vals);
      return NextResponse.json({ ok: true });
    }

    // ── Pages CRUD ─────────────────────────────────────────────
    case "create_page": {
      const { page_type_id, location_id, lang, slug, title, h1, meta_description } = body;
      const { rows: [page] } = await query(
        `INSERT INTO seo_pages (tenant_id, page_type_id, location_id, lang, slug, title, h1, meta_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, page_type_id, location_id, lang, slug, title, h1, meta_description]
      );
      return NextResponse.json({ ok: true, page });
    }

    // Batch: Alle Kombinationen Type×Location×Lang generieren
    case "create_pages_batch": {
      const { type_id, location_ids, langs } = body;
      if (!type_id || !location_ids?.length || !langs?.length) {
        return NextResponse.json({ error: "type_id, location_ids, langs required" }, { status: 400 });
      }

      // Page Type laden für Slug-Templates
      const { rows: [type] } = await query("SELECT * FROM seo_page_types WHERE id = $1", [type_id]);
      if (!type) return NextResponse.json({ error: "Type not found" }, { status: 404 });

      const { rows: locs } = await query("SELECT * FROM seo_locations WHERE id = ANY($1::uuid[])", [location_ids]);
      const locMap = Object.fromEntries(locs.map(l => [l.id, l]));

      let created = 0;
      for (const locId of location_ids) {
        const loc = locMap[locId];
        if (!loc) continue;

        for (const lang of langs) {
          const slugTemplate = type.slug_per_lang?.[lang] || type.slug_template;
          const locSlug = loc.slug?.[lang] || loc.slug?.de || "";
          const pageSlug = `${slugTemplate}-${locSlug}`;
          const locName = loc.name?.[lang] || loc.name?.de || "";

          const title = (type.title_template || "{service} in {ort}")
            .replace("{service}", slugTemplate.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
            .replace("{ort}", locName);
          const h1 = (type.h1_template || title).replace("{service}", slugTemplate.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())).replace("{ort}", locName);

          try {
            await query(
              `INSERT INTO seo_pages (tenant_id, page_type_id, location_id, lang, slug, title, h1)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (tenant_id, slug, lang) DO NOTHING`,
              [id, type_id, locId, lang, pageSlug, title, h1]
            );
            created++;
          } catch { /* skip duplicates */ }
        }
      }

      return NextResponse.json({ ok: true, created });
    }

    case "update_page": {
      const { pageId, ...fields } = body;
      const allowed = ["title", "h1", "meta_description", "intro_html", "local_html", "practical_html", "faq_json", "schema_org", "image_alts", "internal_links", "priority", "changefreq", "status", "word_count"];
      const sets = [];
      const vals = [pageId];
      let i = 2;
      for (const field of allowed) {
        if (fields[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          vals.push(fields[field]);
        }
      }
      // Status-Timestamps
      if (fields.status === "review") { sets.push(`reviewed_at = NOW()`); }
      if (fields.status === "published") { sets.push(`published_at = NOW()`); }
      if (sets.length === 0) return NextResponse.json({ ok: true });
      await query(`UPDATE seo_pages SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2`, [...vals, id]);
      return NextResponse.json({ ok: true });
    }

    case "delete_page": {
      await query("DELETE FROM seo_pages WHERE id = $1 AND tenant_id = $2", [body.pageId, id]);
      return NextResponse.json({ ok: true });
    }

    // ── Bulk Status ────────────────────────────────────────────
    case "bulk_status": {
      const { pageIds, status } = body;
      if (!pageIds?.length || !status) return NextResponse.json({ ok: true });
      const extra = status === "published" ? ", published_at = NOW()" : status === "review" ? ", reviewed_at = NOW()" : "";
      await query(
        `UPDATE seo_pages SET status = $3${extra} WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [pageIds, id, status]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Bulk Delete ────────────────────────────────────────────
    case "bulk_delete": {
      const { pageIds } = body;
      if (!pageIds?.length) return NextResponse.json({ ok: true });
      await query("DELETE FROM seo_pages WHERE id = ANY($1::uuid[]) AND tenant_id = $2", [pageIds, id]);
      return NextResponse.json({ ok: true });
    }

    // ── KI Content Generation ─────────────────────────────────
    case "generate_content": {
      const { pageId } = body;
      if (!pageId) return NextResponse.json({ error: "pageId required" }, { status: 400 });
      if (!UUID_RE.test(String(pageId))) {
        return NextResponse.json({ error: "invalid pageId" }, { status: 400 });
      }
      try {
        const result = await generatePageContent(id, pageId);
        return NextResponse.json({ ok: true, result });
      } catch (error) {
        if (error.code === "page_not_found") {
          return NextResponse.json({ error: "Page not found" }, { status: 404 });
        }
        throw error;
      }
    }

    // ── Batch KI Generation ────────────────────────────────────
    case "generate_batch": {
      const { pageIds } = body;
      if (!Array.isArray(pageIds) || pageIds.length === 0) {
        return NextResponse.json({ error: "pageIds required" }, { status: 400 });
      }
      const uniqueIds = [...new Set(pageIds.map((value) => String(value)))];
      if (uniqueIds.length > MAX_GENERATE_BATCH) {
        return NextResponse.json(
          { error: `Maximal ${MAX_GENERATE_BATCH} Seiten pro Batch` },
          { status: 400 }
        );
      }
      if (uniqueIds.some((pageId) => !UUID_RE.test(pageId))) {
        return NextResponse.json({ error: "invalid pageId" }, { status: 400 });
      }

      const queue = [...uniqueIds];
      const succeeded = [];
      const failed = [];
      const worker = async () => {
        while (queue.length) {
          const pageId = queue.shift();
          try {
            await generatePageContent(id, pageId);
            succeeded.push(pageId);
          } catch (error) {
            failed.push({
              pageId,
              error: error.code === "page_not_found" ? "Page not found" : "Generierung fehlgeschlagen",
            });
            console.error(`[SEO Batch] Failed page ${pageId}:`, error.message);
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(GENERATE_CONCURRENCY, uniqueIds.length) },
          () => worker()
        )
      );

      return NextResponse.json({
        ok: failed.length === 0,
        total: uniqueIds.length,
        succeeded,
        failed,
      }, { status: failed.length ? 207 : 200 });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
