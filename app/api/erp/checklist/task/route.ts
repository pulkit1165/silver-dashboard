import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { addTask } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// Create a new sub-task under a stage.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const stageId = Number(body.stageId);
  const label = String(body.label ?? "").trim();
  if (!stageId || !label) return NextResponse.json({ ok: false, error: "stageId and label are required" }, { status: 400 });
  try {
    const task = await addTask(stageId, label, user.name);
    return NextResponse.json({ ok: true, task });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
