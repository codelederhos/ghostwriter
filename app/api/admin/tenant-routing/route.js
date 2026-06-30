import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "project_key",
  "telegram_route_key",
  "analytics_tenant_key",
  "gsc_site",
  "client_api_url",
  "client_push_enabled",
  "telegram_enabled",
]);

async function ensureSchema() {
  await query(`
    ALTER TABLE tenant_settings
      ADD COLUMN IF NOT EXISTS project_key text,
      ADD COLUMN IF NOT EXISTS telegram_route_key text,
      ADD COLUMN IF NOT EXISTS telegram_bot_token_file text,
      ADD COLUMN IF NOT EXISTS analytics_tenant_key text,
      ADD COLUMN IF NOT EXISTS gsc_site text;

    CREATE TABLE IF NOT EXISTS tenant_routing_audits (
      tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      checked_at timestamptz NOT NULL DEFAULT now(),
      route_ok boolean NOT NULL DEFAULT false,
      analytics_ok boolean NOT NULL DEFAULT false,
      gsc_ok boolean NOT NULL DEFAULT false,
      client_ok boolean NOT NULL DEFAULT true,
      token_mode text,
      problems jsonb NOT NULL DEFAULT '[]'::jsonb,
      details jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
}

function cleanString(value) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text || null;
}

function cleanPayload(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    if (key === "client_push_enabled" || key === "telegram_enabled") {
      out[key] = Boolean(value);
    } else {
      out[key] = cleanString(value);
    }
  }
  return out;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureSchema();

  const { rows } = await query(`
    SELECT
      t.id,
      t.name,
      t.slug,
      t.domain,
      t.status,
      ts.project_key,
      ts.telegram_route_key,
      ts.analytics_tenant_key,
      ts.gsc_site,
      ts.client_api_url,
      ts.client_push_enabled,
      ts.telegram_enabled,
      ts.telegram_chat_id IS NOT NULL AS has_telegram_chat_id,
      ts.telegram_bot_token IS NOT NULL AS has_telegram_token,
      ts.telegram_bot_token_file IS NOT NULL AS has_telegram_token_file,
      a.checked_at,
      a.route_ok,
      a.analytics_ok,
      a.gsc_ok,
      a.client_ok,
      a.token_mode,
      a.problems,
      a.details
    FROM tenants t
    LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
    LEFT JOIN tenant_routing_audits a ON a.tenant_id = t.id
    ORDER BY t.name ASC
  `);

  const tenants = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    status: row.status,
    project_key: row.project_key || "",
    telegram_route_key: row.telegram_route_key || "",
    analytics_tenant_key: row.analytics_tenant_key || "",
    gsc_site: row.gsc_site || "",
    client_api_url: row.client_api_url || "",
    client_push_enabled: Boolean(row.client_push_enabled),
    telegram_enabled: Boolean(row.telegram_enabled),
    has_telegram_chat_id: Boolean(row.has_telegram_chat_id),
    has_telegram_token: Boolean(row.has_telegram_token),
    has_telegram_token_file: Boolean(row.has_telegram_token_file),
    audit: {
      checked_at: row.checked_at,
      route_ok: Boolean(row.route_ok),
      analytics_ok: Boolean(row.analytics_ok),
      gsc_ok: Boolean(row.gsc_ok),
      client_ok: row.client_ok !== false,
      token_mode: row.token_mode || "route-default",
      problems: Array.isArray(row.problems) ? row.problems : [],
      details: row.details || {},
    },
  }));

  return NextResponse.json({ tenants });
}

export async function PATCH(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureSchema();

  const body = await req.json();
  const tenantId = body.tenantId;
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const updates = cleanPayload(body.settings);
  const fields = Object.keys(updates);
  if (!fields.length) return NextResponse.json({ ok: true });

  await query("INSERT INTO tenant_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);

  const sets = fields.map((field, index) => `${field} = $${index + 2}`);
  const values = [tenantId, ...fields.map((field) => updates[field])];
  await query(
    `UPDATE tenant_settings SET ${sets.join(", ")}, updated_at = NOW() WHERE tenant_id = $1`,
    values
  );

  await query("DELETE FROM tenant_routing_audits WHERE tenant_id = $1", [tenantId]);
  return NextResponse.json({ ok: true });
}
