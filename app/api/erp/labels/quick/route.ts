import { NextResponse } from "next/server";
import { getSku, inventoryForSku, getOrCreateTierToken } from "@/lib/erp/queries";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { qrSvg, qrMatrix } from "@/lib/erp/qr";
import { pkd } from "@/lib/format";

export const dynamic = "force-dynamic";

// One-SKU lookup for the Quick Print panel (labels + stickers): sku basics, QR
// for both tiers, and every inventory location this SKU currently has stock
// in — sorted by qty DESC (same heuristic lib/erp/scan.ts's resolveLoc() uses
// elsewhere for "pick a default bin", not labels/bulk's alphabetical-by-bin
// pick) so the client can auto-fill rack from the top entry and offer the rest
// as a lot picker. Accepts ?skuId=<id> (labels screen already has real ids) or
// ?code=<sku_code> (the stickers screen only has codes from sku_abbrev_master).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const url = new URL(req.url);
  let skuId = Number(url.searchParams.get("skuId") || 0);
  const code = (url.searchParams.get("code") || "").trim();
  if (!skuId && code) {
    const [row] = (await getSql()`SELECT id FROM skus WHERE UPPER(sku_code) = ${code.toUpperCase()} LIMIT 1`) as unknown as { id: number }[];
    skuId = row?.id || 0;
  }
  if (!skuId) return NextResponse.json({ ok: false, error: "skuId or code required" }, { status: 400 });

  const sku = await getSku(skuId);
  if (!sku) return NextResponse.json({ ok: false, error: "SKU not found" }, { status: 404 });

  const locations = (await inventoryForSku(skuId))
    .map((l) => ({ batch: l.batch ?? "", rack: l.bin_code ?? "", qty: Number(l.qty) || 0 }))
    .sort((a, b) => b.qty - a.qty);

  const [qrTokenSingle, qrTokenMaster] = await Promise.all([
    getOrCreateTierToken(sku.id, sku.sku_code, "single"),
    getOrCreateTierToken(sku.id, sku.sku_code, "master"),
  ]);

  return NextResponse.json({
    ok: true,
    sku: {
      id: sku.id, sku_code: sku.sku_code, name: sku.name, header: sku.header ?? "",
      unit: sku.unit, price: sku.price, masterQty: sku.master_qty, singleQty: sku.single_qty || 1,
    },
    locations,
    pkd: pkd(),
    qrTokenSingle, qrTokenMaster,
    qrSvgSingle: await qrSvg(qrTokenSingle, 200), qrSvgMaster: await qrSvg(qrTokenMaster, 200),
    qrMatrixSingle: qrMatrix(qrTokenSingle), qrMatrixMaster: qrMatrix(qrTokenMaster),
  });
}
