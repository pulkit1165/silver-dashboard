import { NextResponse } from "next/server";
import { claimJobs, requeueStale } from "@/lib/erp/printBridge";

export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const t = process.env.PRINT_AGENT_TOKEN;
  return !!t && req.headers.get("x-agent-token") === t;
}

// Agent → claim any queued jobs for this PC's printers. Returns raw TSPL (base64).
export async function POST(req: Request) {
  if (!process.env.PRINT_AGENT_TOKEN) return NextResponse.json({ ok: false, error: "PRINT_AGENT_TOKEN not set" }, { status: 503 });
  if (!authed(req)) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const pc = String(b.pc || "").trim();
  const limit = Math.min(20, Math.max(1, Number(b.limit) || 5));
  if (!pc) return NextResponse.json({ ok: false, error: "pc required" }, { status: 400 });
  await requeueStale(120).catch(() => {}); // recover jobs a dead agent left mid-print
  const jobs = await claimJobs(pc, limit);
  return NextResponse.json({ ok: true, jobs });
}
