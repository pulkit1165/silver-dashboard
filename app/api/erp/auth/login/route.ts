import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { verifyPassword } from "@/lib/erp/auth";
import { signSession, SESSION_COOKIE } from "@/lib/erp/jwt";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  // Accept either a username or an email in the same field (plus legacy `email`).
  const id = String(b.login ?? b.username ?? b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!id || !password) {
    return NextResponse.json({ ok: false, error: "Username/email and password are required." }, { status: 400 });
  }

  const [user] = await getSql()`
    SELECT id,name,role,email,password_hash FROM users
    WHERE (lower(username)=${id} OR lower(email)=${id}) AND active=true
    LIMIT 1`;
  const u = user as { id: number; name: string; role: string; password_hash: string | null } | undefined;
  // generic error message — don't reveal whether the account exists
  if (!u || !u.password_hash || !(await verifyPassword(password, u.password_hash))) {
    return NextResponse.json({ ok: false, error: "Invalid username/email or password." }, { status: 401 });
  }

  const token = await signSession({ uid: u.id, role: u.role });
  const res = NextResponse.json({ ok: true, user: { id: u.id, name: u.name, role: u.role } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
