import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelNames, saveLabelName } from "@/lib/erp/labelNames";

export const dynamic = "force-dynamic";

// All per-SKU label name overrides (with manual line breaks).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, names: await getLabelNames() });
}

// Save (or clear, if blank) one SKU's print name.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const skuCode = String(b.skuCode || "").trim();
  if (!skuCode) return NextResponse.json({ ok: false, error: "skuCode required" }, { status: 400 });
  await saveLabelName(skuCode, String(b.name ?? ""), user.name);
  return NextResponse.json({ ok: true });
}
