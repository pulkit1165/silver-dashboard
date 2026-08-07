import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { createToken, listTokens, setTokenActive, deleteToken } from "@/lib/erp/agentTokens";

export const dynamic = "force-dynamic";

// Only admins manage print-agent tokens.
async function admin() {
  const user = await getSessionUser();
  if (!user) return { err: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") return { err: NextResponse.json({ ok: false, error: "Admins only" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const a = await admin(); if (a.err) return a.err;
  return NextResponse.json({ ok: true, tokens: await listTokens() });
}

export async function POST(req: Request) {
  const a = await admin(); if (a.err) return a.err;
  const b = await req.json().catch(() => ({}));
  const t = await createToken(String(b.label || "").trim() || "Print agent", a.user!.name);
  return NextResponse.json({ ok: true, token: t });
}

export async function PATCH(req: Request) {
  const a = await admin(); if (a.err) return a.err;
  const b = await req.json().catch(() => ({}));
  if (!Number(b.id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await setTokenActive(Number(b.id), !!b.active);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await admin(); if (a.err) return a.err;
  const b = await req.json().catch(() => ({}));
  if (!Number(b.id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteToken(Number(b.id));
  return NextResponse.json({ ok: true });
}
