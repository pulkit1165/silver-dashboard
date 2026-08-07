import { NextResponse } from "next/server";
import { cancelAllQueued } from "@/lib/erp/printBridge";
import { agentAuthed } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// Emergency: cancel ALL pending print jobs. Token-authed (bypasses the session gate)
// so it can be triggered instantly.
export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const canceled = await cancelAllQueued();
  return NextResponse.json({ ok: true, canceled });
}
