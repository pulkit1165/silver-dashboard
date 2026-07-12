import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setMrp } from "@/lib/erp/mrp";

export const dynamic = "force-dynamic";

// Bulk MRP update — the "master MRP file". Accepts { updates: [{sku_code, mrp}],
// effective_at?, note? } (parsed client-side from an Excel/CSV file or pasted
// rows). Each row appends history + syncs that SKU's live MRP.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit MRP.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const updates: unknown[] = Array.isArray(b.updates) ? b.updates : [];
  if (updates.length === 0) return NextResponse.json({ ok: false, error: "No rows to update." }, { status: 400 });
  if (updates.length > 5000) return NextResponse.json({ ok: false, error: "Too many rows (max 5000 per upload)." }, { status: 400 });

  const effectiveAt = typeof b.effective_at === "string" ? b.effective_at : undefined;
  const note = typeof b.note === "string" ? b.note : undefined;

  let applied = 0;
  const errors: string[] = [];
  for (const u of updates) {
    const row = (u ?? {}) as Record<string, unknown>;
    const code = String(row.sku_code ?? row.code ?? "").trim();
    const mrp = Number(row.mrp);
    if (!code) { errors.push("Row missing SKU code"); continue; }
    if (!Number.isFinite(mrp) || mrp < 0) { errors.push(`${code}: invalid MRP`); continue; }
    const res = await setMrp({ skuCode: code, mrp, effectiveAt, note, actor: user.name });
    if (res.ok) applied++;
    else errors.push(res.error);
  }

  if (applied > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: "sku.mrp.bulk", entity: "sku",
      summary: `Bulk MRP update — ${applied} item(s)${errors.length ? `, ${errors.length} skipped` : ""}`,
      meta: { applied, failed: errors.length },
    });
  }
  return NextResponse.json({ ok: true, applied, failed: errors.length, errors: errors.slice(0, 50) });
}
