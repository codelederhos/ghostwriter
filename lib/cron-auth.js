/**
 * Cron-Auth: nur ein echtes, in der ENV gesetztes CRON_SECRET wird akzeptiert.
 * Fail-closed: ist CRON_SECRET nicht gesetzt, schlaegt die Pruefung fehl
 * (kein hartcodierter "internal"-Bypass mehr).
 */
export function checkCronSecret(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret") || "";
  return provided.length === secret.length && provided === secret;
}
