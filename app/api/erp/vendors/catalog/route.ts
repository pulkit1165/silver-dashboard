import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { upsertVendorItems, ensureVendorItems, getGroupItemPrices } from "@/lib/erp/vendorCatalog";
import { getSql } from "@/lib/erp/db";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";
const CAN = new Set(["admin", "purchase", "accounts"]);

// GET ?header=... → per-item vendor prices for one group (drives the cost optimizer)
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const header = new URL(req.url).searchParams.get("header") ?? "";
  if (!header) return NextResponse.json({ ok: false, error: "header required" }, { status: 400 });
  return NextResponse.json({ ok: true, rows: await getGroupItemPrices(header) });
}

// POST { vendorId, items:[{sku_code,cp,moq}] }  → upload a vendor's price list
//   OR { vendorId, lead_days, credit_days }      → set vendor service overrides
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!CAN.has(user.role)) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit the vendor catalog.` }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const vendorId = Number(b.vendorId);
  if (!vendorId) return NextResponse.json({ ok: false, error: "Pick a vendor." }, { status: 400 });

  // service overrides
  if (b.lead_days !== undefined || b.credit_days !== undefined) {
    await ensureVendorItems();
    const lead = b.lead_days === null || b.lead_days === "" ? null : Number(b.lead_days);
    const credit = b.credit_days === null || b.credit_days === "" ? null : Number(b.credit_days);
    await getSql()`UPDATE vendors SET lead_days=${Number.isFinite(lead as number) ? lead : null}, credit_days=${Number.isFinite(credit as number) ? credit : null} WHERE id=${vendorId}`;
    return NextResponse.json({ ok: true });
  }

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return NextResponse.json({ ok: false, error: "No rows to import." }, { status: 400 });
  if (items.length > 20000) return NextResponse.json({ ok: false, error: "Too many rows in one upload." }, { status: 400 });

  const res = await upsertVendorItems(vendorId, items, user.name);
  logActivity({ actor: user.name, actorRole: user.role, action: "vendor.catalog.upload", entity: "vendor", entityId: String(vendorId), summary: `Uploaded ${res.upserted} catalog price(s) for vendor #${vendorId}${res.unmatched.length ? ` · ${res.unmatched.length} unmatched` : ""}` });
  return NextResponse.json({ ok: true, ...res });
}
