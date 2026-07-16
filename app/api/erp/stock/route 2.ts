import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { stockAnalytics } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const w = Number(new URL(req.url).searchParams.get("window"));
  const windowDays = [30, 90, 180, 365].includes(w) ? w : 90;
  return NextResponse.json({ ok: true, window: windowDays, rows: await stockAnalytics(windowDays) });
}
