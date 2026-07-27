import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { getAnalytics } from "@/lib/erp/analytics";

export const dynamic = "force-dynamic";

// Analytics bundle for a chosen date window (client date-range filter).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const days = Number(new URL(req.url).searchParams.get("days")) || 365;
  const data = await getAnalytics(days, new Date().toISOString());
  return NextResponse.json({ ok: true, data });
}
