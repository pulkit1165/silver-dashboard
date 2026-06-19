import { NextResponse } from "next/server";
import { getSkuByToken, totalQty, inventoryForSku, stockStatus } from "@/lib/erp/queries";
import { qrSvg, qrDataUrl } from "@/lib/erp/qr";
import { extractToken } from "@/lib/erp/scan";

export const dynamic = "force-dynamic";

// Fetch QR + SKU details (used for label rendering / reprint / validation).
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token: raw } = await ctx.params;
  const token = extractToken(raw);
  const sku = await getSkuByToken(token);
  if (!sku) return NextResponse.json({ ok: false, error: "Unknown QR code." }, { status: 404 });
  const qty = await totalQty(sku.id);
  const [svg, dataUrl, locations] = await Promise.all([qrSvg(token), qrDataUrl(token), inventoryForSku(sku.id)]);
  return NextResponse.json({ ok: true, sku, qty, status: stockStatus(sku, qty), locations, svg, dataUrl });
}
