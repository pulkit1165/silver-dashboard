import { NextResponse } from "next/server";
import { clearAllLayouts } from "@/lib/erp/labelLayout";
import { agentAuthed } from "@/lib/erp/agentTokens";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// DISABLED BY DEFAULT. This used to wipe every saved aligner layout so sizes fell
// back to their built-in baseline — a one-off during development. It is the ONLY
// path that can delete all of an operator's saved alignments at once, so leaving it
// callable (on the print-agent token) risked silently erasing the client's work.
// It now refuses unless an explicit confirmation phrase is POSTed, and every wipe is
// written to the activity log so it can never happen untraced again.
const CONFIRM = "WIPE-ALL-LABEL-LAYOUTS";

export async function POST(req: Request) {
  if (!(await agentAuthed(req))) return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (body?.confirm !== CONFIRM) {
    return NextResponse.json(
      { ok: false, error: `Refused: this wipes ALL saved label alignments. POST {"confirm":"${CONFIRM}"} to proceed.` },
      { status: 400 },
    );
  }
  const cleared = await clearAllLayouts(CONFIRM);
  await logActivity({ actor: "system", action: "label.layouts.reset", entity: "label_layout", summary: `Wiped ${cleared} saved label alignment(s) via reset-layouts` }).catch(() => {});
  return NextResponse.json({ ok: true, cleared });
}
