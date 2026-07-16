import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { editStage, deleteStage } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// Edit a stage's title / owner / description.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const patch: { title?: string; owner?: string; description?: string } = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.owner === "string") patch.owner = body.owner.trim();
  if (typeof body.description === "string") patch.description = body.description;
  try {
    await editStage(Number(id), patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await deleteStage(Number(id), user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
