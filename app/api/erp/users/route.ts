import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listAllUsers, createUser } from "@/lib/erp/users";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// GET → all users (admin only). POST → create a user with a username + password.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "users")) return NextResponse.json({ ok: false, error: "Only admins can manage users." }, { status: 403 });
  return NextResponse.json({ ok: true, users: await listAllUsers() });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "users")) return NextResponse.json({ ok: false, error: "Only admins can create users." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const res = await createUser({ name: b.name, username: b.username, password: b.password, role: b.role, email: b.email ?? null, active: b.active });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({ actor: user.name, actorRole: user.role, action: "user.create", entity: "user", entityId: res.id, summary: `Created user ${String(b.username || "").toLowerCase()} (${b.role})` }).catch(() => {});
  return NextResponse.json({ ok: true, id: res.id });
}
