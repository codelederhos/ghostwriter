import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { buildAuthUrl } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId fehlt" }, { status: 400 });

  const url = buildAuthUrl(tenantId);
  return NextResponse.redirect(url);
}
