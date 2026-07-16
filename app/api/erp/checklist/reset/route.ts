import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { resetChecklist } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// Wipe every stage/task and re-seed the starter template. Admin only — it's destructive.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  if (!canWrite(user.role, "users")) return NextResponse.json({ ok: false, error: "Only an admin can reset the checklist" }, { status: 403 });
  try {
    await resetChecklist(user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
