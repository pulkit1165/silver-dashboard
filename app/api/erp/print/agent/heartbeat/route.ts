import { NextResponse } from "next/server";
import { heartbeat } from "@/lib/erp/printBridge";
import { agentAuthed, touchToken } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// Agent → "these printers are alive on this PC" (called every ~30s).
export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const pc = String(b.pc || "").trim();
  const printers: string[] = Array.isArray(b.printers) ? b.printers.map((x: unknown) => String(x)) : [];
  if (!pc) return NextResponse.json({ ok: false, error: "pc required" }, { status: 400 });
  await heartbeat(pc, printers);
  touchToken(req.headers.get("x-agent-token") || "", pc).catch(() => {});
  return NextResponse.json({ ok: true });
}
