import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { runRuleBook } from "@/lib/erp/rulebook";

export const dynamic = "force-dynamic";

// Runs every rule's live self-test and returns the results grouped by module.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, modules: await runRuleBook(), at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
