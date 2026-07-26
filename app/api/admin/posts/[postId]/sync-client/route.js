import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { syncPostToClient } from "@/lib/pipeline/steps/publisher.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function isAuthorized(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const expected = process.env.GHOSTWRITER_ADMIN_TOKEN || "";
  if (bearer && expected && timingSafeEquals(bearer, expected)) return true;
  return Boolean(await requireAdmin());
}

export async function POST(request, props) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = await props.params;
  try {
    const result = await syncPostToClient(String(params.postId || "").trim());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 502 }
    );
  }
}
