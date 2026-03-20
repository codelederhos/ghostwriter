import { NextResponse } from "next/server";
import { exchangeCode, fetchGbpAccountsAndLocations } from "@/lib/google/oauth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const base = process.env.NEXT_PUBLIC_BASE_URL || "";

  if (error) {
    return NextResponse.redirect(`${base}/admin?google_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/admin?google_error=missing_params`);
  }

  // Decode tenantId from state
  let tenantId;
  try {
    tenantId = Buffer.from(state, "base64url").toString("utf-8");
  } catch {
    return NextResponse.redirect(`${base}/admin?google_error=invalid_state`);
  }

  // Verify tenant exists
  const { rows: [tenant] } = await query("SELECT id FROM tenants WHERE id = $1", [tenantId]);
  if (!tenant) {
    return NextResponse.redirect(`${base}/admin?google_error=tenant_not_found`);
  }

  try {
    const accessToken = await exchangeCode(code, tenantId);

    // Try to fetch GBP accounts right away so admin can pick in UI
    let accounts = [];
    try {
      accounts = await fetchGbpAccountsAndLocations(accessToken);
    } catch {
      // Non-fatal — admin can still use Drive without GBP scope
    }

    // If there's exactly 1 account + 1 location, auto-set them
    if (accounts.length === 1 && accounts[0].locations?.length === 1) {
      const acc = accounts[0];
      const loc = acc.locations[0];
      const accountId = acc.name.split("/").pop();
      const locationId = loc.name.split("/").pop();
      await query(
        `UPDATE tenant_settings SET gbp_account_id = $2, gbp_location_id = $3, gbp_enabled = true WHERE tenant_id = $1`,
        [tenantId, accountId, locationId]
      );
    }

  } catch (err) {
    console.error("[Google Callback]", err);
    return NextResponse.redirect(
      `${base}/admin/tenants/${tenantId}?tab=google&google_error=${encodeURIComponent(err.message)}`
    );
  }

  return NextResponse.redirect(`${base}/admin/tenants/${tenantId}?tab=google&google_connected=1`);
}
