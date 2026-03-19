import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rows } = await query("SELECT key, value FROM system_config");
  const config = {};
  for (const row of rows) config[row.key] = row.value;
  return NextResponse.json(config);
}

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key, value } = await req.json();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await query(
    `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );

  // Preisänderungen historisch festhalten — Preis pro Post bleibt beim Erstellungszeitpunkt eingefroren
  if (key === "pricing") {
    await query(
      "INSERT INTO pricing_history (valid_from, pricing) VALUES (NOW(), $1)",
      [JSON.stringify(value)]
    );
  }

  return NextResponse.json({ ok: true });
}
