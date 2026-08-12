import { NextResponse } from "next/server";
import { validateToken } from "@/lib/erp/scan";
import { getSessionUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Require a signed-in user: this returns SKU details + all open sales orders, so it must
  // not be reachable anonymously (info disclosure + valid-SKU probing).
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "");
  if (!code) return NextResponse.json({ ok: false, error: "No code provided." }, { status: 400 });
  const result = await validateToken(code);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
