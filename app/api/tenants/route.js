import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import bcrypt from "bcryptjs";

const DEFAULT_ANGLES = [
  { key: 1, label: "Zahlenfakt / Rechenbeispiel", active: true },
  { key: 2, label: "Kundenperspektive / Testimonial", active: true },
  { key: 3, label: "FAQ / Frage-Antwort", active: true },
  { key: 4, label: "Vergleich / Andere vs. Wir", active: true },
  { key: 5, label: "Tipp / Actionable Advice", active: true },
];

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows } = await query(
    `SELECT t.*, ts.is_active as autopilot_active, ts.frequency_hours, ts.next_run_at,
            tp.company_name, tp.languages
     FROM tenants t
     LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
     LEFT JOIN tenant_profiles tp ON tp.tenant_id = t.id
     ORDER BY t.created_at DESC`
  );
  return NextResponse.json({ tenants: rows });
}

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "create": return createTenant(body);
    case "update": return updateTenant(body);
    case "delete": return deleteTenant(body);
    case "update_settings": return updateSettings(body);
    case "update_profile": return updateProfile(body);
    case "update_topics": return updateTopics(body);
    case "list_users": return listUsers(body);
    case "create_user": return createUser(body);
    case "delete_user": return deleteUser(body);
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

async function createTenant({ name, slug, domain }) {
  if (!name || !slug) {
    return NextResponse.json({ error: "Name und Slug erforderlich" }, { status: 400 });
  }

  const s = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");

  const { rows: [tenant] } = await query(
    "INSERT INTO tenants (name, slug, domain) VALUES ($1, $2, $3) RETURNING *",
    [name, s, domain || null]
  );

  // Create empty settings + profile
  await query("INSERT INTO tenant_settings (tenant_id) VALUES ($1)", [tenant.id]);
  await query("INSERT INTO tenant_profiles (tenant_id, company_name) VALUES ($1, $2)", [tenant.id, name]);

  return NextResponse.json({ ok: true, tenant });
}

async function updateTenant({ id, name, slug, domain, status }) {
  await query(
    "UPDATE tenants SET name = COALESCE($2, name), slug = COALESCE($3, slug), domain = COALESCE($4, domain), status = COALESCE($5, status), updated_at = NOW() WHERE id = $1",
    [id, name, slug, domain, status]
  );
  return NextResponse.json({ ok: true });
}

async function deleteTenant({ id }) {
  await query("DELETE FROM tenants WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}

async function updateSettings({ tenantId, settings }) {
  const s = settings;
  // Encrypt sensitive fields
  const encryptedFields = {};
  for (const field of ["text_api_key", "image_api_key", "gbp_oauth_token", "gbp_refresh_token"]) {
    if (s[field] !== undefined && s[field] !== null && s[field] !== "") {
      encryptedFields[field] = encrypt(s[field]);
    }
  }

  const merged = { ...s, ...encryptedFields };

  await query(
    `UPDATE tenant_settings SET
      text_provider = COALESCE($2, text_provider),
      text_api_key = COALESCE($3, text_api_key),
      text_model = COALESCE($4, text_model),
      text_custom_endpoint = COALESCE($5, text_custom_endpoint),
      image_provider = COALESCE($6, image_provider),
      image_api_key = COALESCE($7, image_api_key),
      image_style_prefix = COALESCE($8, image_style_prefix),
      telegram_bot_token = COALESCE($9, telegram_bot_token),
      telegram_chat_id = COALESCE($10, telegram_chat_id),
      report_email = COALESCE($11, report_email),
      frequency_hours = COALESCE($12, frequency_hours),
      is_active = COALESCE($13, is_active),
      updated_at = NOW()
    WHERE tenant_id = $1`,
    [
      tenantId,
      merged.text_provider, merged.text_api_key, merged.text_model, merged.text_custom_endpoint,
      merged.image_provider, merged.image_api_key, merged.image_style_prefix,
      merged.telegram_bot_token, merged.telegram_chat_id, merged.report_email,
      merged.frequency_hours, merged.is_active,
    ]
  );

  return NextResponse.json({ ok: true });
}

async function updateProfile({ tenantId, profile }) {
  const p = profile;
  await query(
    `UPDATE tenant_profiles SET
      company_name = COALESCE($2, company_name),
      industry = COALESCE($3, industry),
      region = COALESCE($4, region),
      usp = COALESCE($5, usp),
      positioning = COALESCE($6, positioning),
      services = COALESCE($7, services),
      brand_voice = COALESCE($8, brand_voice),
      languages = COALESCE($9, languages),
      target_audience = COALESCE($10, target_audience),
      website_url = COALESCE($11, website_url),
      updated_at = NOW()
    WHERE tenant_id = $1`,
    [
      tenantId,
      p.company_name, p.industry, p.region, p.usp, p.positioning,
      p.services, p.brand_voice, p.languages, p.target_audience, p.website_url,
    ]
  );
  return NextResponse.json({ ok: true });
}

async function updateTopics({ tenantId, topics }) {
  // Delete existing and re-insert
  await query("DELETE FROM tenant_topics WHERE tenant_id = $1", [tenantId]);
  for (const t of topics) {
    await query(
      `INSERT INTO tenant_topics (tenant_id, category_id, label, description, default_cta, is_active, angles)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, t.category_id, t.label, t.description, t.default_cta || "LEARN_MORE", t.is_active !== false, JSON.stringify(t.angles || DEFAULT_ANGLES)]
    );
  }
  return NextResponse.json({ ok: true });
}

async function listUsers({ tenantId }) {
  const { rows } = await query(
    "SELECT id, email, name, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC",
    [tenantId]
  );
  return NextResponse.json({ users: rows });
}

async function createUser({ tenantId, email, name, password }) {
  if (!email || !password) {
    return NextResponse.json({ error: "E-Mail und Passwort erforderlich" }, { status: 400 });
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows: [user] } = await query(
    "INSERT INTO users (email, name, password_hash, role, tenant_id) VALUES ($1, $2, $3, 'customer', $4) RETURNING id, email, name, role, created_at",
    [email, name || null, hash, tenantId]
  );
  return NextResponse.json({ ok: true, user });
}

async function deleteUser({ userId }) {
  await query("DELETE FROM users WHERE id = $1 AND role = 'customer'", [userId]);
  return NextResponse.json({ ok: true });
}
