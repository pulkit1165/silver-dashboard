import { NextResponse } from "next/server";
import { clearAllLayouts } from "@/lib/erp/labelLayout";
import { agentAuthed } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// One-off maintenance: wipe saved aligner offsets so every size uses its current
// built-in layout as the clean baseline. Token-authed (bypasses the session gate).
export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const cleared = await clearAllLayouts();
  return NextResponse.json({ ok: true, cleared });
}
