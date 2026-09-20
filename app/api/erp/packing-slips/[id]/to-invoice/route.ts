import { NextResponse } from "next/server";
import type { Sql } from "postgres";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getPackingSlip } from "@/lib/erp/packing-slips";
import { createDraftFromSalesOrder, createDraftFromPackingSlip } from "@/lib/erp/invoices";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

type SlipRow = { itemCode?: string; qtyDispatched?: string | number; mrp?: string | number; unit?: string; itemDesc?: string };
type SlipData = { completed?: Array<{ rows?: SlipRow[] }>; activeRows?: SlipRow[] };

// Aggregate the slip's dispatched lines (completed cases + active rows) per item code,
// keeping the first non-empty mrp/unit/description so a manual (SO-less) bill can price them.
function dispatchedLines(data: SlipData): Array<{ code: string; qty: number; mrp: number; unit: string; desc: string }> {
  const rows: SlipRow[] = [
    ...((data?.completed ?? []).flatMap((c) => c?.rows ?? [])),
    ...(data?.activeRows ?? []),
  ];
  const m = new Map<string, { code: string; qty: number; mrp: number; unit: string; desc: string }>();
  for (const r of rows) {
    const code = String(r?.itemCode ?? "").trim().toUpperCase();
    const q = Number(r?.qtyDispatched) || 0;
    if (!code || q <= 0) continue;
    const cur = m.get(code) ?? { code, qty: 0, mrp: 0, unit: "", desc: "" };
    cur.qty += q;
    if (!cur.mrp) cur.mrp = Number(r?.mrp) || 0;
    if (!cur.unit) cur.unit = String(r?.unit ?? "").trim();
    if (!cur.desc) cur.desc = String(r?.itemDesc ?? "").trim();
    m.set(code, cur);
  }
  return [...m.values()];
}

// Turn the slip's dispatched lines into ONE verified Delivery Order for a Sales Order,
// so the SO-based billing engine can invoice it. Only SKUs on the SO are included.
async function materializeSlipPackage(sql: Sql, soId: number, slipNo: string, lines: ReturnType<typeof dispatchedLines>, actor: string): Promise<number> {
  if (!lines.length) return 0;
  const soLines = (await sql`
    SELECT l.id AS so_line_id, l.sku_id, upper(s.sku_code) AS code
    FROM so_lines l JOIN skus s ON s.id = l.sku_id WHERE l.so_id = ${soId}`) as unknown as
    Array<{ so_line_id: number; sku_id: number; code: string }>;
  const byCode = new Map<string, { so_line_id: number; sku_id: number }>();
  for (const l of soLines) byCode.set(l.code, { so_line_id: l.so_line_id, sku_id: l.sku_id });

  const pkgLines: Array<{ so_line_id: number; sku_id: number; qty: number }> = [];
  for (const l of lines) { const m = byCode.get(l.code); if (m) pkgLines.push({ ...m, qty: l.qty }); }
  if (!pkgLines.length) return 0;

  const [pkg] = (await sql`
    INSERT INTO packages (so_id, package_no, status, slip_no, do_type, created_by)
    VALUES (${soId}, '1', 'verified', ${slipNo}, 'PS', ${actor}) RETURNING id`) as unknown as Array<{ id: number }>;
  for (const ln of pkgLines) {
    await sql`INSERT INTO package_lines (package_id, so_id, so_line_id, sku_id, qty, packed_by)
      VALUES (${pkg.id}, ${soId}, ${ln.so_line_id}, ${ln.sku_id}, ${ln.qty}, ${actor})`;
  }
  return pkgLines.length;
}

// Push a saved packing slip to BILLING → create the DRAFT invoice, return its id.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "invoices")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create bills.` }, { status: 403 });
  }

  const { id } = await params;
  const slip = (await getPackingSlip(Number(id))) as (Awaited<ReturnType<typeof getPackingSlip>> & { data?: SlipData }) | undefined;
  if (!slip) return NextResponse.json({ ok: false, error: "Packing slip not found." }, { status: 404 });

  const sql = getSql();

  // Idempotent: if this slip already has an open draft, just re-open it.
  const [existingDraft] = (await sql`SELECT id FROM invoices WHERE packing_slip_id=${slip.id} AND status='draft' ORDER BY id DESC LIMIT 1`) as unknown as Array<{ id: number }>;
  if (existingDraft) return NextResponse.json({ ok: true, invoiceId: existingDraft.id, reused: true });

  const lines = dispatchedLines(slip.data ?? {});

  // Path A — slip is linked to a Sales Order that exists → bill through the SO engine
  // (respects SO net-rate overrides + invoiced-qty accounting). Materialize a DO if none.
  const [so] = slip.so_no
    ? (await sql`SELECT id FROM sales_orders WHERE so_no=${slip.so_no}`) as unknown as Array<{ id: number }>
    : [];
  if (so) {
    const [counts] = (await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='packed')::int AS packed FROM packages WHERE so_id=${so.id}`) as unknown as Array<{ n: number; packed: number }>;
    let note = "";
    if (counts.n === 0) {
      const made = await materializeSlipPackage(sql, so.id, slip.slip_no, lines, user.name);
      if (!made) return NextResponse.json({ ok: false, error: "This slip has no dispatched quantities to bill. Enter Qty Dispatched on the slip first." }, { status: 400 });
      note = `${made} line(s) from slip`;
    } else if (counts.packed > 0) {
      const v = await sql`UPDATE packages SET status='verified' WHERE so_id=${so.id} AND status='packed' RETURNING id`;
      note = `${v.length} case(s) verified`;
    }
    const res = await createDraftFromSalesOrder(so.id, { createdBy: user.name, packingSlipId: slip.id });
    if ("error" in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    logActivity({ actor: user.name, actorRole: user.role, action: "invoice.from_slip", entity: "invoice", entityId: String(res.id), summary: `Bill from slip ${slip.slip_no} · ${slip.so_no} → draft #${res.id}${note ? ` (${note})` : ""}` }).catch(() => {});
    return NextResponse.json({ ok: true, invoiceId: res.id });
  }

  // Path B — MANUAL slip (no Sales Order): bill directly from the slip's lines at the
  // party's standing discount. Requires the party to match a customer in the master.
  if (!slip.party) {
    return NextResponse.json({ ok: false, error: "This slip has no Sales Order and no party — set a customer on the slip to bill it." }, { status: 400 });
  }
  const res = await createDraftFromPackingSlip({ packingSlipId: slip.id, party: slip.party, lines, createdBy: user.name });
  if ("error" in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  logActivity({ actor: user.name, actorRole: user.role, action: "invoice.from_slip", entity: "invoice", entityId: String(res.id), summary: `Bill from manual slip ${slip.slip_no} · ${slip.party} → draft #${res.id}` }).catch(() => {});
  return NextResponse.json({ ok: true, invoiceId: res.id });
}
