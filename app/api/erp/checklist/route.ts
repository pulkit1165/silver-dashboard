import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { listChecklist } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// The whole live checklist (auto-seeds the template on first ever load).
export async function GET() {
  await getSessionUser();
  try {
    return NextResponse.json({ ok: true, stages: await listChecklist() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
