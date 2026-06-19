import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { SESSION_COOKIE } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

// Lightweight sign-in / role switch for the demo. (Layer real auth/2FA on top.)
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const userId = Number(b.userId);
  const [user] = await getSql()`SELECT id,name,role FROM users WHERE id=${userId} AND active=true`;
  if (!user) return NextResponse.json({ ok: false, error: "Unknown user." }, { status: 404 });
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(SESSION_COOKIE, String(userId), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
