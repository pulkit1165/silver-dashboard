import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { addStage } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// Add a whole new stage to the loop.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
  try {
    await addStage(title, user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
