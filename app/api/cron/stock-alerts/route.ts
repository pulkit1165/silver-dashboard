import { NextResponse, type NextRequest } from "next/server";
import { runStockAlertScan } from "@/lib/erp/stock-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Auth: Vercel cron sends  Authorization: Bearer <CRON_SECRET>
// Manual trigger: same header, or call with ?secret=<CRON_SECRET>
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const query  = req.nextUrl.searchParams.get("secret") ?? "";
  return header === `Bearer ${secret}` || query === secret;
}

// GET — called by Vercel cron once daily (see vercel.json). Also safe to hit
// manually/repeatedly: the dedupe in runStockAlertScan() means a re-run the
// same day only re-sends for a SKU that's newly breached or has escalated.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runStockAlertScan();
  return NextResponse.json({ ok: true, ...result });
}
