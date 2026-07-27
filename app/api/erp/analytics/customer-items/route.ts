import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { customerItems } from "@/lib/erp/analytics";

export const dynamic = "force-dynamic";

// Drill-down: the items a given customer buys, highest → lowest.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const customer = new URL(req.url).searchParams.get("customer")?.trim();
  if (!customer) return NextResponse.json({ ok: false, error: "customer required" }, { status: 400 });
  const items = await customerItems(customer);
  return NextResponse.json({ ok: true, items });
}
