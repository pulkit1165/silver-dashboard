import { NextResponse } from "next/server";
import { lookupPartyDiscount } from "@/lib/erp/oracle-rates";

export const dynamic = "force-dynamic";

// GET /api/erp/party-discount?party=<customer name>
// Read-only: the customer's standing discount %, taken from their most
// recent Oracle Sales Order header. Used to auto-suggest a net rate
// (MRP × (1 - discount%)) the moment a customer is picked, matching how
// the legacy app actually prices new orders.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const party = url.searchParams.get("party") ?? "";
  if (!party.trim()) return NextResponse.json({ ok: false, error: "party is required" }, { status: 400 });

  try {
    const discount = await lookupPartyDiscount(party);
    return NextResponse.json({ ok: true, discount });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
