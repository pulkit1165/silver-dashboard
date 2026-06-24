import { NextResponse } from "next/server";
import { listPackingSlips, upsertPackingSlip } from "@/lib/erp/packing-slips";
import { getSessionUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ slips: await listPackingSlips() });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const slipNo = String(b.slipNo ?? "").trim();
  if (!slipNo) return NextResponse.json({ ok: false, error: "Packing Slip No. required to save." }, { status: 400 });
  const res = await upsertPackingSlip({
    slipNo,
    soNo: b.soNo ?? null,
    party: b.party ?? null,
    data: b.data ?? {},
    updatedBy: user.name,
  });
  return NextResponse.json({ ok: true, id: res.id, updated_at: res.updated_at, updated_by: user.name });
}
