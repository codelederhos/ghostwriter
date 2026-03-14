import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/lib/pipeline/index.js";

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, preview } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  try {
    const result = await runPipeline(tenantId, { preview: !!preview });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[Autopilot/run]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
