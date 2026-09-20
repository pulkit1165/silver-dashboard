import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import {
  getDiscountPartyData,
  setPartyPct,
  setPartyItemNetRate,
  setPartyItemFoc,
  type PartyPctKind,
} from "@/lib/erp/party-masters";
import { setPartyKItem, removePartyKItem } from "@/lib/erp/partyKItems";

export const dynamic = "force-dynamic";

// Discount Master hub. GET ?customer_id → all of one party's discount data
// (disc/OGL/FOC + per-item net rate / FOC / K). POST performs one edit.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const cid = Number(new URL(req.url).searchParams.get("customer_id"));
  if (!cid) return NextResponse.json({ ok: false, error: "customer_id required." }, { status: 400 });
  try {
    const data = await getDiscountPartyData(cid);
    if (!data) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as {
    action?: string; customer_id?: unknown; sku_id?: unknown; pct?: unknown;
    kind?: unknown; net_rate?: unknown; foc_pct?: unknown; on?: unknown;
  };
  const cid = Number(b.customer_id);
  if (!cid) return NextResponse.json({ ok: false, error: "customer_id required." }, { status: 400 });

  try {
    switch (b.action) {
      case "party-pct": {
        const kind = String(b.kind) as PartyPctKind;
        if (!["disc", "ogl", "foc"].includes(kind)) return NextResponse.json({ ok: false, error: "Bad kind." }, { status: 400 });
        const res = await setPartyPct(kind, { customerId: cid, pct: Number(b.pct), actor: user.name });
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 422 });
        await logActivity({ actor: user.name, actorRole: user.role, action: `customer.${kind}.set`, entity: "customer", entityId: cid, summary: `Set party ${kind}% = ${Number(b.pct)} for #${cid}` });
        return NextResponse.json({ ok: true });
      }
      case "item-net-rate": {
        const res = await setPartyItemNetRate({ customerId: cid, skuId: Number(b.sku_id), netRate: Number(b.net_rate), actor: user.name });
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 422 });
        await logActivity({ actor: user.name, actorRole: user.role, action: "customer.party_item.set", entity: "customer", entityId: cid, summary: `Set party×item net rate ${Number(b.net_rate)} (item #${Number(b.sku_id)}) for #${cid}` });
        return NextResponse.json({ ok: true });
      }
      case "item-foc": {
        const res = await setPartyItemFoc({ customerId: cid, skuId: Number(b.sku_id), focPct: Number(b.foc_pct), actor: user.name });
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 422 });
        await logActivity({ actor: user.name, actorRole: user.role, action: "customer.party_item_foc.set", entity: "customer", entityId: cid, summary: `Set party×item FOC ${Number(b.foc_pct)}% (item #${Number(b.sku_id)}) for #${cid}` });
        return NextResponse.json({ ok: true });
      }
      case "item-k": {
        const skuId = Number(b.sku_id);
        const on = b.on === true || b.on === "true";
        if (!skuId) return NextResponse.json({ ok: false, error: "sku_id required." }, { status: 400 });
        if (on) { const ok = await setPartyKItem(cid, skuId, user.name); if (!ok) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 }); }
        else await removePartyKItem(cid, skuId);
        await logActivity({ actor: user.name, actorRole: user.role, action: "customer.party_k.set", entity: "customer", entityId: cid, summary: `${on ? "Marked" : "Unmarked"} item #${skuId} K for #${cid}` });
        return NextResponse.json({ ok: true, on });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
