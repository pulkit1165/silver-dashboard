import { NextResponse } from "next/server";
import { getSku, inventoryForSku, getOrCreateTierToken } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { qrSvg } from "@/lib/erp/qr";
import { pkd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Bulk label generation for printing. Body: { skuIds: number[] }. One
// response entry per SKU, carrying BOTH the Single and Master QR (distinct
// tokens, so scanning one tells the warehouse system which tier it is) — the
// client picks which to show per its own Single/Master toggle without a
// second round-trip.
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
      const [qrTokenSingle, qrTokenMaster] = await Promise.all([
        getOrCreateTierToken(sku.id, sku.sku_code, "single"),
        getOrCreateTierToken(sku.id, sku.sku_code, "master"),
      ]);
      return {
        skuId: sku.id, sku_code: sku.sku_code, name: sku.name,
        unit: sku.unit, price: sku.price, masterQty: sku.master_qty, singleQty: sku.single_qty || 1,
        rack: loc?.bin_code ?? "", lot: loc?.batch ?? "", pkd: today,
        qrTokenSingle, qrTokenMaster,
        qrSvgSingle: await qrSvg(qrTokenSingle, 200), qrSvgMaster: await qrSvg(qrTokenMaster, 200),
      };
    }),
  );
  return NextResponse.json({ labels: labels.filter(Boolean) });
}
