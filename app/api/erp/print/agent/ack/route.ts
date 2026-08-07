import { NextResponse } from "next/server";
import { ackJob } from "@/lib/erp/printBridge";
import { agentAuthed } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// Agent → report the outcome of a claimed job (done / failed).
export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await ackJob(id, !!b.ok, b.error ? String(b.error).slice(0, 500) : undefined);
  return NextResponse.json({ ok: true });
}
