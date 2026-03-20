/**
 * Google OAuth 2.0 Token Management
 * Reuses gbp_oauth_token / gbp_refresh_token columns for unified Google tokens.
 */

import { query } from "../db.js";
import { encrypt } from "../crypto.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Returns a valid (non-expired) Google access token.
 * Auto-refreshes if token is expired or expires within 5 minutes.
 */
export async function getValidGoogleToken(tenantId, settings) {
  const accessToken = settings.gbp_oauth_token;
  const refreshToken = settings.gbp_refresh_token;

  if (!refreshToken) throw new Error("Kein Google Refresh-Token – bitte neu verbinden");

  const expiry = settings.google_token_expiry
    ? Number(settings.google_token_expiry)
    : 0;
  const needsRefresh = !accessToken || Date.now() > expiry - 5 * 60 * 1000;

  if (needsRefresh) {
    return refreshGoogleToken(tenantId, refreshToken);
  }
  return accessToken;
}

async function refreshGoogleToken(tenantId, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token-Refresh fehlgeschlagen: ${err}`);
  }

  const data = await res.json();
  const newExpiry = Date.now() + (data.expires_in || 3600) * 1000;

  await query(
    `UPDATE tenant_settings SET gbp_oauth_token = $2, google_token_expiry = $3 WHERE tenant_id = $1`,
    [tenantId, encrypt(data.access_token), newExpiry]
  );

  return data.access_token;
}

/**
 * Build OAuth authorization URL
 */
export function buildAuthUrl(tenantId) {
  const base = "https://accounts.google.com/o/oauth2/v2/auth";
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: Buffer.from(tenantId).toString("base64url"),
  });
  return `${base}?${params}`;
}

/**
 * Exchange authorization code for tokens + save to DB
 */
export async function exchangeCode(code, tenantId) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Code-Exchange fehlgeschlagen: ${err}`);
  }

  const data = await res.json();
  const expiry = Date.now() + (data.expires_in || 3600) * 1000;

  await query(
    `UPDATE tenant_settings SET
       gbp_oauth_token   = $2,
       gbp_refresh_token = COALESCE($3, gbp_refresh_token),
       google_token_expiry = $4,
       google_scopes     = $5,
       updated_at        = NOW()
     WHERE tenant_id = $1`,
    [
      tenantId,
      encrypt(data.access_token),
      data.refresh_token ? encrypt(data.refresh_token) : null,
      expiry,
      data.scope || null,
    ]
  );

  return data.access_token;
}

/**
 * Fetch GBP accounts + locations for a given access token
 */
export async function fetchGbpAccountsAndLocations(accessToken) {
  // List accounts
  const accRes = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!accRes.ok) throw new Error(`GBP accounts ${accRes.status}`);
  const accData = await accRes.json();
  const accounts = accData.accounts || [];

  // For each account, load locations
  const results = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const locRes = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title,storeCode`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const locData = locRes.ok ? await locRes.json() : {};
        return { ...acc, locations: locData.locations || [] };
      } catch {
        return { ...acc, locations: [] };
      }
    })
  );

  return results;
}
