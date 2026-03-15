import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check if pipeline_logs table exists
  try {
    const { rows } = await query(`
      SELECT pl.id, pl.step, pl.status, pl.message, pl.created_at,
             t.name as tenant_name
      FROM pipeline_logs pl
      JOIN tenants t ON t.id = pl.tenant_id
      ORDER BY pl.created_at DESC
      LIMIT 200
    `);
    return NextResponse.json({ logs: rows });
  } catch {
    // Table might not exist yet
    return NextResponse.json({ logs: [] });
  }
}
