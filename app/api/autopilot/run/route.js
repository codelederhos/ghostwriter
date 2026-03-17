import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/lib/pipeline/index.js";

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, preview, override, isTest } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  // Fire & Forget — Pipeline läuft auf Server weiter, auch wenn Browser/Tab geschlossen wird
  runPipeline(tenantId, {
    preview: !!preview,
    override: override || null,
    isTest: isTest || false,
  }).catch(err => console.error("[Autopilot/run] Background error:", err.message));

  return NextResponse.json({ ok: true, status: "started" });
}
