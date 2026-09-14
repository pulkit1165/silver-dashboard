import { NextResponse } from "next/server";
import type { Sql } from "postgres";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getPackingSlip } from "@/lib/erp/packing-slips";
import { createDraftFromSalesOrder } from "@/lib/erp/invoices";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

type SlipRow = { itemCode?: string; qtyDispatched?: string | number };
type SlipData = { completed?: Array<{ rows?: SlipRow[] }>; activeRows?: SlipRow[] };

// Sum dispatched qty per item code across the slip's completed cases + active rows.
function dispatchedByCode(data: SlipData): Map<string, number> {
  const rows: SlipRow[] = [
    ...((data?.completed ?? []).flatMap((c) => c?.rows ?? [])),
    ...(data?.activeRows ?? []),
  ];
  const m = new Map<string, number>();
  for (const r of rows) {
    const code = String(r?.itemCode ?? "").trim().toUpperCase();
    const q = Number(r?.qtyDispatched) || 0;
    if (code && q > 0) m.set(code, (m.get(code) ?? 0) + q);
  }
  return m;
}

// Turn the slip's dispatched lines into ONE verified Delivery Order (package) for the
// SO, so the existing billing engine (which bills verified-package qty) can invoice it.
// Only the SKUs that are on the SO are billed. Returns the number of lines created.
async function materializeSlipPackage(sql: Sql, soId: number, slipNo: string, data: SlipData, actor: string): Promise<number> {
  const qtyByCode = dispatchedByCode(data);
  if (qtyByCode.size === 0) return 0;
  const soLines = (await sql`
    SELECT l.id AS so_line_id, l.sku_id, upper(s.sku_code) AS code
    FROM so_lines l JOIN skus s ON s.id = l.sku_id WHERE l.so_id = ${soId}`) as unknown as
    Array<{ so_line_id: number; sku_id: number; code: string }>;
  const byCode = new Map<string, { so_line_id: number; sku_id: number }>();
  for (const l of soLines) byCode.set(l.code, { so_line_id: l.so_line_id, sku_id: l.sku_id });

  const lines: Array<{ so_line_id: number; sku_id: number; qty: number }> = [];
  for (const [code, qty] of qtyByCode) { const m = byCode.get(code); if (m) lines.push({ ...m, qty }); }
  if (!lines.length) return 0;

  const [pkg] = (await sql`
    INSERT INTO packages (so_id, package_no, status, slip_no, do_type, created_by)
    VALUES (${soId}, '1', 'verified', ${slipNo}, 'PS', ${actor}) RETURNING id`) as unknown as Array<{ id: number }>;
  for (const ln of lines) {
    await sql`INSERT INTO package_lines (package_id, so_id, so_line_id, sku_id, qty, packed_by)
      VALUES (${pkg.id}, ${soId}, ${ln.so_line_id}, ${ln.sku_id}, ${ln.qty}, ${actor})`;
  }
  return lines.length;
}

// Push a saved packing slip to BILLING → create the DRAFT invoice and return its id.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create bills.` }, { status: 403 });
  }

  const { id } = await params;
  const slip = (await getPackingSlip(Number(id))) as (Awaited<ReturnType<typeof getPackingSlip>> & { data?: SlipData }) | undefined;
  if (!slip) return NextResponse.json({ ok: false, error: "Packing slip not found." }, { status: 404 });
  if (!slip.so_no) {
    return NextResponse.json({ ok: false, error: "This slip isn't linked to a Sales Order, so it can't be billed." }, { status: 400 });
  }

  const sql = getSql();
  const [so] = (await sql`SELECT id FROM sales_orders WHERE so_no=${slip.so_no}`) as unknown as Array<{ id: number }>;
  if (!so) {
    return NextResponse.json({ ok: false, error: `Sales Order ${slip.so_no} isn't in the system — can't bill this slip.` }, { status: 400 });
  }

  // Idempotent: if this slip already has an open draft, just re-open it.
  const [existingDraft] = (await sql`SELECT id FROM invoices WHERE packing_slip_id=${slip.id} AND status='draft' ORDER BY id DESC LIMIT 1`) as unknown as Array<{ id: number }>;
  if (existingDraft) return NextResponse.json({ ok: true, invoiceId: existingDraft.id, reused: true });

  // Make sure there's verified (billable) qty for this SO. If cases were packed via
  // "Done Case", verify them. Otherwise materialize a DO from the slip's dispatched lines.
  const [counts] = (await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='packed')::int AS packed FROM packages WHERE so_id=${so.id}`) as unknown as Array<{ n: number; packed: number }>;
  let note = "";
  if (counts.n === 0) {
    const made = await materializeSlipPackage(sql, so.id, slip.slip_no, slip.data ?? {}, user.name);
    if (!made) {
      return NextResponse.json({ ok: false, error: "This slip has no dispatched quantities to bill. Enter Qty Dispatched on the slip (or pack the cases) first." }, { status: 400 });
    }
    note = `${made} line(s) from slip`;
  } else if (counts.packed > 0) {
    const v = await sql`UPDATE packages SET status='verified' WHERE so_id=${so.id} AND status='packed' RETURNING id`;
    note = `${v.length} case(s) verified`;
  }

  const res = await createDraftFromSalesOrder(so.id, { createdBy: user.name, packingSlipId: slip.id });
  if ("error" in res) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  logActivity({
    actor: user.name, actorRole: user.role, action: "invoice.from_slip", entity: "invoice", entityId: String(res.id),
    summary: `Bill from slip ${slip.slip_no} · ${slip.so_no} → draft invoice #${res.id}${note ? ` (${note})` : ""}`,
  }).catch(() => {});

  return NextResponse.json({ ok: true, invoiceId: res.id });
}
