import { query } from "./db.js";
import { createHash } from "crypto";

// Brute-Force-Schutz für den Login.
// IP- + Account-basiertes Rate-Limiting mit Zeitfenster.
// Alle Werte per ENV überschreibbar.
const WINDOW_MIN = parseInt(process.env.LOGIN_WINDOW_MIN || "15", 10);
const MAX_PER_IP = parseInt(process.env.LOGIN_MAX_PER_IP || "10", 10);
const MAX_PER_ACCOUNT = parseInt(process.env.LOGIN_MAX_PER_ACCOUNT || "5", 10);

// Echte Client-IP ermitteln (hinter Cloudflare + Nginx).
// Reihenfolge: Cloudflare-Edge → Nginx → generischer Proxy-Header.
export function getClientIp(req) {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// IP nur gehasht speichern (DSGVO — keine Klartext-IP in der DB).
export function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "gw-login-guard";
  return createHash("sha256").update(salt + ":" + ip).digest("hex");
}

// Prüft, ob IP oder Account aktuell gesperrt sind.
// Fail-open: bei DB-Fehler wird NICHT gesperrt (legit User nie aussperren).
export async function checkLoginBlock(ipHash, email) {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE ip_hash = $1) AS ip_fails,
         COUNT(*) FILTER (WHERE email = $2) AS email_fails,
         MIN(created_at) FILTER (WHERE ip_hash = $1) AS ip_oldest,
         MIN(created_at) FILTER (WHERE email = $2) AS email_oldest
       FROM login_attempts
       WHERE success = false
         AND created_at > NOW() - ($3 || ' minutes')::interval
         AND (ip_hash = $1 OR email = $2)`,
      [ipHash, email || null, String(WINDOW_MIN)]
    );
    const r = rows[0] || {};
    const ipFails = parseInt(r.ip_fails || "0", 10);
    const emailFails = parseInt(r.email_fails || "0", 10);

    let blocked = false;
    let oldest = null;
    if (ipFails >= MAX_PER_IP) {
      blocked = true;
      oldest = r.ip_oldest;
    }
    if (emailFails >= MAX_PER_ACCOUNT) {
      blocked = true;
      if (!oldest || (r.email_oldest && new Date(r.email_oldest) < new Date(oldest))) {
        oldest = r.email_oldest;
      }
    }
    if (!blocked) return { blocked: false };

    const unblockAt = new Date(new Date(oldest).getTime() + WINDOW_MIN * 60000);
    const retryAfterSec = Math.max(60, Math.ceil((unblockAt.getTime() - Date.now()) / 1000));
    return { blocked: true, retryAfterSec, retryAfterMin: Math.ceil(retryAfterSec / 60) };
  } catch (err) {
    console.error("[LoginGuard] check fehlgeschlagen (fail-open):", err.message);
    return { blocked: false };
  }
}

// Versuch protokollieren. Bei Erfolg werden die Fehlversuche von IP + Account
// im Fenster gelöscht → sauberer Reset für legitime User.
export async function recordLoginAttempt(ipHash, email, success) {
  try {
    await query(
      "INSERT INTO login_attempts (ip_hash, email, success) VALUES ($1, $2, $3)",
      [ipHash, email || null, success]
    );
    if (success) {
      await query(
        "DELETE FROM login_attempts WHERE success = false AND (ip_hash = $1 OR email = $2)",
        [ipHash, email || null]
      );
    }
    // Gelegentliches Cleanup alter Einträge (>1 Tag), kein eigener Cron nötig.
    if (Math.random() < 0.05) {
      await query("DELETE FROM login_attempts WHERE created_at < NOW() - interval '1 day'");
    }
  } catch (err) {
    console.error("[LoginGuard] record fehlgeschlagen:", err.message);
  }
}
