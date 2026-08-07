import { NextResponse } from "next/server";
import { claimJobs, requeueStale } from "@/lib/erp/printBridge";
import { agentAuthed } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// Agent → claim any queued jobs for this PC's printers. Returns raw TSPL (base64).
export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const pc = String(b.pc || "").trim();
  const limit = Math.min(20, Math.max(1, Number(b.limit) || 5));
  if (!pc) return NextResponse.json({ ok: false, error: "pc required" }, { status: 400 });
  await requeueStale(120).catch(() => {}); // recover jobs a dead agent left mid-print
  const jobs = await claimJobs(pc, limit);
  return NextResponse.json({ ok: true, jobs });
}
