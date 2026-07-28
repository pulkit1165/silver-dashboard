import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { getAnalytics } from "@/lib/erp/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Analytics bundle for a chosen date window (client date-range filter).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") || "", to = sp.get("to") || "";
  const data = await getAnalytics(from && to ? { from, to } : undefined, new Date().toISOString());
  return NextResponse.json({ ok: true, data });
}
