import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setPartyPct, partyPctCfg, type PartyPctKind } from "@/lib/erp/party-masters";

export const dynamic = "force-dynamic";

const KINDS: PartyPctKind[] = ["disc", "ogl", "foc"];
const isKind = (k: string): k is PartyPctKind => (KINDS as string[]).includes(k);

// Bulk party-% update: { updates: [{ code, pct }], effective_at?, note? }.
export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const { kind } = await params;
  if (!isKind(kind)) return NextResponse.json({ ok: false, error: "Unknown master." }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const updates: unknown[] = Array.isArray(b.updates) ? b.updates : [];
  if (updates.length === 0) return NextResponse.json({ ok: false, error: "No rows to update." }, { status: 400 });
  if (updates.length > 5000) return NextResponse.json({ ok: false, error: "Too many rows (max 5000)." }, { status: 400 });
  const effectiveAt = typeof b.effective_at === "string" ? b.effective_at : undefined;
  const note = typeof b.note === "string" ? b.note : undefined;

  let applied = 0;
  const errors: string[] = [];
  for (const u of updates) {
    const row = (u ?? {}) as Record<string, unknown>;
    const code = String(row.code ?? row.customer_code ?? "").trim();
    const pct = Number(row.pct ?? row.percent ?? row.value);
    if (!code) { errors.push("Row missing customer code"); continue; }
    const res = await setPartyPct(kind, { code, pct, effectiveAt, note, actor: user.name });
    if (res.ok) applied++;
    else errors.push(res.error);
  }
  if (applied > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: `customer.${kind}_pct.bulk`, entity: "customer",
      summary: `Bulk ${partyPctCfg(kind).label} update — ${applied} party(ies)${errors.length ? `, ${errors.length} skipped` : ""}`,
      meta: { applied, failed: errors.length },
    });
  }
  return NextResponse.json({ ok: true, applied, failed: errors.length, errors: errors.slice(0, 50) });
}
