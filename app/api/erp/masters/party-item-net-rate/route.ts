import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import {
  setPartyItemNetRate, getPartyItemHistory, getPartyItemRatesForCustomer,
} from "@/lib/erp/party-masters";

export const dynamic = "force-dynamic";

// GET ?customer_id=&sku_id=  → change history for that pair
// GET ?customer_id=          → { map: { [sku_id]: net_rate } } for the sales screen
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const customerId = Number(sp.get("customer_id"));
  if (!customerId) return NextResponse.json({ ok: false, error: "customer_id required" }, { status: 400 });
  const skuId = Number(sp.get("sku_id"));
  if (skuId) return NextResponse.json({ ok: true, history: await getPartyItemHistory(customerId, skuId) });
  const map = await getPartyItemRatesForCustomer(customerId);
  return NextResponse.json({ ok: true, map: Object.fromEntries(map) });
}

// PATCH { customer_id, sku_id, net_rate, effective_at?, note? }
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const res = await setPartyItemNetRate({
    customerId: Number(b.customer_id) || undefined,
    partyCode: typeof b.party_code === "string" ? b.party_code : undefined,
    skuId: Number(b.sku_id) || undefined,
    skuCode: typeof b.sku_code === "string" ? b.sku_code : undefined,
    netRate: Number(b.net_rate),
    effectiveAt: typeof b.effective_at === "string" ? b.effective_at : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
    actor: user.name,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "party_item.net_rate", entity: "customer", entityId: res.customerId,
    summary: `Set party-item net rate (cust ${res.customerId}, sku ${res.skuId}) to ₹${res.net_rate}`,
    meta: { customerId: res.customerId, skuId: res.skuId, netRate: res.net_rate },
  });
  return NextResponse.json(res);
}
