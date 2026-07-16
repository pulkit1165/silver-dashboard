import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { toggleTask, editTaskLabel, deleteTask } from "@/lib/erp/checklist";

export const dynamic = "force-dynamic";

// Tick/untick a task, or rename it.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to edit" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.done === "boolean") await toggleTask(Number(id), body.done, user.name);
    if (typeof body.label === "string" && body.label.trim()) await editTaskLabel(Number(id), body.label.trim());
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
    await deleteTask(Number(id), user.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
