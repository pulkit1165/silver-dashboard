import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { updateUser } from "@/lib/erp/users";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// PATCH → edit a user (name/username/role/email/active) and/or set a new password.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "users")) return NextResponse.json({ ok: false, error: "Only admins can edit users." }, { status: 403 });
  const idNum = Number((await ctx.params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  // Guard: an admin can't deactivate or de-admin THEMSELVES (avoids locking out the last admin).
  if (idNum === user.id && (b.active === false || (b.role && b.role !== user.role))) {
    return NextResponse.json({ ok: false, error: "You can't change your own role or deactivate your own account." }, { status: 400 });
  }
  const res = await updateUser(idNum, { name: b.name, username: b.username, role: b.role, email: b.email, active: b.active, password: b.password });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({ actor: user.name, actorRole: user.role, action: "user.update", entity: "user", entityId: idNum, summary: `Updated user #${idNum}${b.password ? " (password reset)" : ""}` }).catch(() => {});
  return NextResponse.json({ ok: true });
}
