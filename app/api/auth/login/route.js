import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSession, setSessionCookie, ensureAdminUser } from "@/lib/auth";
import { getClientIp, hashIp, checkLoginBlock, recordLoginAttempt } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    await ensureAdminUser();

    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email und Passwort erforderlich" }, { status: 400 });
    }

    const normEmail = email.toLowerCase().trim();
    const ipHash = hashIp(getClientIp(req));

    // Brute-Force-Schutz: IP- + Account-basierte Sperre prüfen
    const block = await checkLoginBlock(ipHash, normEmail);
    if (block.blocked) {
      return NextResponse.json(
        { error: `Zu viele Fehlversuche. Bitte in ${block.retryAfterMin} Minuten erneut versuchen.` },
        { status: 429, headers: { "Retry-After": String(block.retryAfterSec) } }
      );
    }

    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1 AND is_active = true",
      [normEmail]
    );
    const user = rows[0];
    if (!user) {
      await recordLoginAttempt(ipHash, normEmail, false);
      return NextResponse.json({ error: "Ungültige Anmeldedaten" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordLoginAttempt(ipHash, normEmail, false);
      return NextResponse.json({ error: "Ungültige Anmeldedaten" }, { status: 401 });
    }

    await recordLoginAttempt(ipHash, normEmail, true);

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(token, expiresAt);

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      redirect: user.role === "customer" ? "/kunde" : "/admin",
    });
  } catch (err) {
    console.error("[Login]", err);
    return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
  }
}
