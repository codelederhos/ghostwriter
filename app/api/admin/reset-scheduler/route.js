import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await query("UPDATE tenant_settings SET next_run_at = NOW() WHERE is_active = true");
  return NextResponse.json({ ok: true });
}
