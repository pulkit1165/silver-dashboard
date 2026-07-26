import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setPartyPct, getPartyPctHistory, partyPctCfg, type PartyPctKind } from "@/lib/erp/party-masters";

export const dynamic = "force-dynamic";

const KINDS: PartyPctKind[] = ["disc", "ogl", "foc"];
const isKind = (k: string): k is PartyPctKind => (KINDS as string[]).includes(k);

// GET ?customer_id=… → that customer's change history for this % master.
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { kind } = await params;
  if (!isKind(kind)) return NextResponse.json({ ok: false, error: "Unknown master." }, { status: 400 });
  const id = Number(new URL(req.url).searchParams.get("customer_id"));
  if (!id) return NextResponse.json({ ok: false, error: "customer_id required" }, { status: 400 });
  return NextResponse.json({ ok: true, history: await getPartyPctHistory(kind, id) });
}

// PATCH { customer_id, pct, effective_at?, note? } → append a version + mirror live.
export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const { kind } = await params;
  if (!isKind(kind)) return NextResponse.json({ ok: false, error: "Unknown master." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const res = await setPartyPct(kind, {
    customerId: Number(b.customer_id) || undefined,
    code: typeof b.code === "string" ? b.code : undefined,
    pct: Number(b.pct),
    effectiveAt: typeof b.effective_at === "string" ? b.effective_at : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
    actor: user.name,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: `customer.${kind}_pct`, entity: "customer", entityId: res.customerId,
    summary: `Set ${partyPctCfg(kind).label} for ${res.code} to ${res.effective}%`,
  });
  return NextResponse.json({ ok: true, customer: { id: res.customerId, code: res.code, pct: res.effective } });
}
