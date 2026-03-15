import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSession, setSessionCookie, ensureAdminUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    await ensureAdminUser();

    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email und Passwort erforderlich" }, { status: 400 });
    }

    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1 AND is_active = true",
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) {
      return NextResponse.json({ error: "Ungültige Anmeldedaten" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Ungültige Anmeldedaten" }, { status: 401 });
    }

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
