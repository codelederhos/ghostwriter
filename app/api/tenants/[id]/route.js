import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;

  const { rows: [tenant] } = await query("SELECT * FROM tenants WHERE id = $1", [id]);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows: [settings] } = await query(
    "SELECT * FROM tenant_settings WHERE tenant_id = $1", [id]
  );
  const { rows: [profile] } = await query(
    "SELECT * FROM tenant_profiles WHERE tenant_id = $1", [id]
  );
  const { rows: topics } = await query(
    "SELECT * FROM tenant_topics WHERE tenant_id = $1 ORDER BY category_id", [id]
  );

  // Mask sensitive fields
  const masked = settings ? { ...settings } : {};
  for (const field of ["text_api_key", "image_api_key", "gbp_oauth_token", "gbp_refresh_token"]) {
    if (masked[field]) masked[field] = "••••••••";
  }

  return NextResponse.json({ tenant, settings: masked, profile, topics });
}
