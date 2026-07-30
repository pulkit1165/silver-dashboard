import { NextResponse } from "next/server";
import { heartbeat } from "@/lib/erp/printBridge";

export const dynamic = "force-dynamic";

// Print agents authenticate with a shared token (not a user session).
function authed(req: Request): boolean {
  const t = process.env.PRINT_AGENT_TOKEN;
  return !!t && req.headers.get("x-agent-token") === t;
}

// Agent → "these printers are alive on this PC" (called every ~10s).
export async function POST(req: Request) {
  if (!process.env.PRINT_AGENT_TOKEN) return NextResponse.json({ ok: false, error: "PRINT_AGENT_TOKEN not set" }, { status: 503 });
  if (!authed(req)) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const pc = String(b.pc || "").trim();
  const printers: string[] = Array.isArray(b.printers) ? b.printers.map((x: unknown) => String(x)) : [];
  if (!pc) return NextResponse.json({ ok: false, error: "pc required" }, { status: 400 });
  await heartbeat(pc, printers);
  return NextResponse.json({ ok: true });
}
