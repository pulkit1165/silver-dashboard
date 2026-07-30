import { NextResponse } from "next/server";
import { listBridgePrinters } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

// App → list bridge printers (agents that have heartbeated), for the dropdown.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, printers: await listBridgePrinters() });
}
