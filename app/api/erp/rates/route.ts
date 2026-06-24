import { NextResponse } from "next/server";
import { lookupItemRates, lookupPartyItemRates } from "@/lib/erp/oracle-rates";

export const dynamic = "force-dynamic";

// GET /api/erp/rates?item=<text>&party=<text optional>
// Read-only historical rate reference from Oracle — used to suggest rates
// while building a sales order; nothing here ever writes to Oracle.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const item = url.searchParams.get("item") ?? "";
  const party = url.searchParams.get("party") ?? "";
  if (!item.trim()) return NextResponse.json({ ok: false, error: "item is required" }, { status: 400 });

  try {
    const [itemRates, partyRates] = await Promise.all([
      lookupItemRates(item),
      party.trim() ? lookupPartyItemRates(item, party) : Promise.resolve([]),
    ]);
    return NextResponse.json({ ok: true, itemRates, partyRates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
