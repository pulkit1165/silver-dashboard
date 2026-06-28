import { NextResponse } from "next/server";
import { getSku, inventoryForSku } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { barcodeSvg } from "@/lib/erp/barcode";
import { pkd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Bulk barcode-label generation for printing. Body: { skuIds: number[] }.
// One response entry per SKU — Single vs Master is purely a client-side qty/
// layout choice (the barcode itself is the same code either way), so this
// only needs to fetch each SKU once.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.skuIds) ? body.skuIds.map(Number) : [];
  const today = pkd();

  const labels = await Promise.all(
    ids.map(async (id) => {
      const sku = await getSku(id);
      if (!sku) return null;
      const locations = await inventoryForSku(sku.id);
      const loc = locations[0];
      const code = sku.barcode_code || sku.sku_code;
      return {
        skuId: sku.id, sku_code: sku.sku_code, code, name: sku.name,
        unit: sku.unit, price: sku.price, masterQty: sku.master_qty, singleQty: sku.single_qty || 1,
        rack: loc?.bin_code ?? "", lot: loc?.batch ?? "", pkd: today,
        svg: barcodeSvg(code),
      };
    }),
  );
  return NextResponse.json({ labels: labels.filter(Boolean) });
}
