import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { getPartyKRows, getPartyKSkuIds, setPartyKItem, removePartyKItem } from "@/lib/erp/partyKItems";

export const dynamic = "force-dynamic";

// GET ?customer_id=25 → the K sku_ids (+ rows) for that party. Used by the sales
// decoder (auto-mark K on party select) and the Discount Master grid.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const cid = Number(new URL(req.url).searchParams.get("customer_id"));
  if (!cid) return NextResponse.json({ ok: true, sku_ids: [], rows: [] });
  const [sku_ids, rows] = await Promise.all([getPartyKSkuIds(cid), getPartyKRows(cid)]);
  return NextResponse.json({ ok: true, sku_ids, rows });
}

// POST { customer_id, sku_id, on } → add/remove one K assignment (Discount Master).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { customer_id?: unknown; sku_id?: unknown; on?: unknown };
  const cid = Number(b.customer_id);
  const skuId = Number(b.sku_id);
  const on = b.on === true || b.on === "true";
  if (!cid || !skuId) return NextResponse.json({ ok: false, error: "customer_id and sku_id required." }, { status: 400 });

  if (on) {
    const ok = await setPartyKItem(cid, skuId, user.name);
    if (!ok) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
  } else {
    await removePartyKItem(cid, skuId);
  }
  await logActivity({
    actor: user.name, actorRole: user.role, action: "customer.party_k.set",
    entity: "customer", entityId: cid,
    summary: `${on ? "Marked" : "Unmarked"} item #${skuId} as K for customer #${cid}`,
  });
  return NextResponse.json({ ok: true, on });
}
