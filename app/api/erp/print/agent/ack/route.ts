import { NextResponse } from "next/server";
import { ackJob } from "@/lib/erp/printBridge";

export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const t = process.env.PRINT_AGENT_TOKEN;
  return !!t && req.headers.get("x-agent-token") === t;
}

// Agent → report the outcome of a claimed job (done / failed).
export async function POST(req: Request) {
  if (!process.env.PRINT_AGENT_TOKEN) return NextResponse.json({ ok: false, error: "PRINT_AGENT_TOKEN not set" }, { status: 503 });
  if (!authed(req)) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await ackJob(id, !!b.ok, b.error ? String(b.error).slice(0, 500) : undefined);
  return NextResponse.json({ ok: true });
}
