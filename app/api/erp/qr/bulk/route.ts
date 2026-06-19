import { NextResponse } from "next/server";
import { getSku, getSkus, totalQty, stockStatus } from "@/lib/erp/queries";
import { qrSvg } from "@/lib/erp/qr";

export const dynamic = "force-dynamic";

// Bulk QR generation for label printing. Body: { skuIds?: number[] } (omit = all).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.skuIds) && body.skuIds.length
    ? body.skuIds.map(Number)
    : (await getSkus()).map((s) => s.id);

  const labels = await Promise.all(
    ids.map(async (id) => {
      const sku = await getSku(id);
      if (!sku) return null;
      const qty = await totalQty(sku.id);
      return {
        skuId: sku.id, sku_code: sku.sku_code, name: sku.name, category: sku.category,
        token: sku.qr_token, qty, status: stockStatus(sku, qty), svg: await qrSvg(sku.qr_token, 150),
      };
    }),
  );
  return NextResponse.json({ labels: labels.filter(Boolean) });
}
