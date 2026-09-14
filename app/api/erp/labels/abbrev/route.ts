import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { getAbbrevMaster } from "@/lib/erp/skuAbbrev";

export const dynamic = "force-dynamic";

// Abbreviation-sticker data for one SKU → returned as LabelFill fields so the
// Sticker Designer's "Load SKU" preview shows the real trade name / size / pack.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
  if (!code) return NextResponse.json({ ok: false, error: "No code." }, { status: 400 });
  const row = await getAbbrevMaster(code);
  if (!row) return NextResponse.json({ ok: true, found: false });
  return NextResponse.json({
    ok: true, found: true,
    abbr1: row.line1, abbr2: row.line2, unit: row.unit,
    singleQty: row.singlePack || 1, masterQty: row.masterPack || row.singlePack || 1,
  });
}
