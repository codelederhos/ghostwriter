import { query } from "./db.js";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "gw_session";
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || "7", 10);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);

  await query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function getSession() {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const { rows } = await query(
    `SELECT s.*, u.email, u.name, u.role, u.tenant_id
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = true`,
    [tokenHash]
  );

  return rows[0] || null;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return null;
  }
  return session;
}

export async function requireCustomer() {
  const session = await getSession();
  if (!session || session.role !== "customer" || !session.tenant_id) {
    return null;
  }
  return session;
}

export function setSessionCookie(token, expiresAt) {
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie() {
  const cookieStore = cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function destroySession(token) {
  const tokenHash = hashToken(token);
  await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

// Seed admin user on first run
export async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows } = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (rows.length > 0) return;

  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(password, 12);
  await query(
    "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)",
    [email, hash, "Admin", "admin"]
  );
  console.log("[Auth] Admin user seeded:", email);
}
