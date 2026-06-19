import { NextResponse } from "next/server";
import { validateToken } from "@/lib/erp/scan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "");
  if (!code) return NextResponse.json({ ok: false, error: "No code provided." }, { status: 400 });
  const result = await validateToken(code);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
