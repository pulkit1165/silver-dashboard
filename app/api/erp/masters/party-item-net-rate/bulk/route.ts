import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { applyPartyItemBulk } from "@/lib/erp/party-masters";

export const dynamic = "force-dynamic";

// Bulk load the party × item net-rate sheet (the deduped Excel):
// { updates: [{ party | party_code, sku_code, net_rate }], effective_at?, note? }
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const updates: unknown[] = Array.isArray(b.updates) ? b.updates : [];
  if (updates.length === 0) return NextResponse.json({ ok: false, error: "No rows to load." }, { status: 400 });
  if (updates.length > 20000) return NextResponse.json({ ok: false, error: "Too many rows (max 20000)." }, { status: 400 });

  const res = await applyPartyItemBulk(
    updates as Array<{ party?: string; party_code?: string; sku_code?: string; net_rate: number }>,
    typeof b.effective_at === "string" ? b.effective_at : undefined,
    typeof b.note === "string" ? b.note : undefined,
    user.name,
  );
  if (res.applied > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: "party_item.net_rate.bulk", entity: "customer",
      summary: `Bulk party-item net-rate load — ${res.applied} pair(s)${res.failed ? `, ${res.failed} skipped` : ""}`,
      meta: { applied: res.applied, failed: res.failed },
    });
  }
  return NextResponse.json({ ok: true, ...res });
}
