import { NextResponse } from "next/server";
import { listPackingSlips, upsertPackingSlip, deleteAllPackingSlips } from "@/lib/erp/packing-slips";
import { getSessionUser } from "@/lib/erp/session";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ slips: await listPackingSlips() });
}

// DELETE /api/erp/packing-slips?all=1 — admin-only clear of the whole saved archive.
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Only admins can clear saved slips." }, { status: 403 });
  if (new URL(req.url).searchParams.get("all") !== "1") {
    return NextResponse.json({ ok: false, error: "Add ?all=1 to confirm clearing every saved slip." }, { status: 400 });
  }
  const count = await deleteAllPackingSlips();
  await logActivity({ actor: user.name, actorRole: user.role, action: "packing_slip.clear_all", entity: "packing_slip", summary: `Cleared all ${count} saved packing slip(s)`, meta: { count } });
  return NextResponse.json({ ok: true, deleted: count });
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
