import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getSql } from "./db";
import { resolveQrToken, totalQty, inventoryForSku, stockStatus } from "./queries";

const TOKEN_ERROR: Record<string, string> = {
  unknown: "Unknown or invalid QR code.",
  disabled: "QR Code Disabled.",
  replaced: "This QR code has been replaced by a newer one.",
};
import type { ScanAction, Sku } from "./types";

export interface ScanInput {
  user: { id: number; name: string };
  token: string;
  action: ScanAction;
  qty?: number;
  warehouseId?: number;
  binId?: number;
  toWarehouseId?: number;
  toBinId?: number;
  refDoc?: string;
  packageNo?: string;
  device?: string;
  batch?: string;
}

export interface ScanResult {
  ok: boolean;
  message: string;
  error?: string;
  eventId?: number;
  sku?: Sku & { qty: number; status: string };
  data?: Record<string, unknown>;
}

/** Normalise a scanned payload (raw token, or a URL/JSON that contains it). */
export function extractToken(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  try {
    const u = new URL(s);
    const t = u.searchParams.get("t") || u.searchParams.get("token");
    if (t) return t.trim();
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /^[A-Za-z]+-[0-9A-F]+$/i.test(last)) return last;
  } catch {
    /* not a URL */
  }
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s);
      if (o.t || o.token) return String(o.t || o.token).trim();
    } catch {
      /* not json */
    }
  }
  return s;
}

type Client = Sql | TransactionSql<Record<string, never>>;

async function recordEvent(client: Client, e: {
  token: string; skuId: number | null; user: { id: number; name: string };
  action: string; qty: number; warehouseId?: number | null; binId?: number | null;
  refDoc?: string | null; device?: string | null; status: "success" | "failure"; error?: string | null;
}): Promise<number> {
  const [r] = await client`
    INSERT INTO scan_events (qr_token,sku_id,user_id,user_name,action,qty,warehouse_id,bin_id,ref_doc,device,status,error)
    VALUES (${e.token},${e.skuId},${e.user.id},${e.user.name},${e.action},${e.qty},
            ${e.warehouseId ?? null},${e.binId ?? null},${e.refDoc ?? null},${e.device ?? null},${e.status},${e.error ?? null})
    RETURNING id`;
  return (r as { id: number }).id;
}

async function skuView(sku: Sku) {
  const qty = await totalQty(sku.id);
  return { ...sku, qty, status: stockStatus(sku, qty), locations: await inventoryForSku(sku.id) };
}

/** Validate a scanned QR token — used by the scanner before showing actions. */
export async function validateToken(rawToken: string) {
  const token = extractToken(rawToken);
  const resolved = await resolveQrToken(token);
  if (resolved.state !== "active" || !resolved.sku) {
    return { ok: false as const, error: TOKEN_ERROR[resolved.state] ?? "Unknown or invalid QR code." };
  }
  const sku = resolved.sku;
  if (sku.status !== "active") return { ok: false as const, error: `SKU ${sku.sku_code} is inactive.` };
  const openOrders = await getSql()`
    SELECT so.so_no, so.status, so.invoice_no, l.qty, l.picked_qty, l.packed_qty, l.dispatched_qty
    FROM so_lines l JOIN sales_orders so ON so.id=l.so_id
    WHERE l.sku_id=${sku.id} AND so.status IN ('confirmed','picked','packed','partially dispatched')`;
  return { ok: true as const, token, sku: await skuView(sku), openOrders };
}

async function resolveLoc(client: Client, skuId: number, warehouseId?: number, binId?: number) {
  if (warehouseId) return { warehouseId, binId: binId ?? 0 };
  const [top] = await client`SELECT warehouse_id, bin_id FROM inventory WHERE sku_id=${skuId} ORDER BY qty DESC LIMIT 1`;
  if (top) return { warehouseId: (top as { warehouse_id: number }).warehouse_id, binId: (top as { bin_id: number }).bin_id };
  const [wh] = await client`SELECT id FROM warehouses ORDER BY id LIMIT 1`;
  return { warehouseId: (wh as { id: number }).id, binId: 0 };
}

async function adjustInventory(client: Client, skuId: number, whId: number, binId: number, batch: string, delta: number) {
  await client`
    INSERT INTO inventory (sku_id,warehouse_id,bin_id,batch,qty) VALUES (${skuId},${whId},${binId},${batch},${delta})
    ON CONFLICT (sku_id,warehouse_id,bin_id,batch) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty`;
}

async function logMove(client: Client, skuId: number, whId: number, binId: number, type: string, qty: number, ref: string, userId: number) {
  await client`INSERT INTO stock_moves (sku_id,warehouse_id,bin_id,type,qty,ref_doc,user_id) VALUES (${skuId},${whId},${binId},${type},${qty},${ref},${userId})`;
}

async function qtyAt(client: Client, skuId: number, whId: number, binId: number, batch: string): Promise<number> {
  const [r] = await client`SELECT COALESCE(SUM(qty),0)::float8 AS q FROM inventory WHERE sku_id=${skuId} AND warehouse_id=${whId} AND bin_id=${binId} AND batch=${batch}`;
  return (r as { q: number }).q;
}

/**
 * Perform a scan action. ALWAYS records an audit event (success or failure with
 * the reason), validates the token in the backend, and updates inventory atomically.
 */
export async function performScan(input: ScanInput): Promise<ScanResult> {
  const sql = getSql();
  const token = extractToken(input.token);
  const device = input.device ?? "web";
  const resolved = await resolveQrToken(token);
  const sku = resolved.sku;

  if (resolved.state !== "active" || !sku) {
    const error = TOKEN_ERROR[resolved.state] ?? "Unknown or invalid QR code.";
    const id = await recordEvent(sql, {
      token, skuId: null, user: input.user, action: input.action, qty: input.qty ?? 0,
      status: "failure", error, device,
    });
    return { ok: false, message: "Scan rejected", error, eventId: id };
  }

  const qty = input.qty && input.qty > 0 ? input.qty : 1;
  const batch = input.batch ?? "";
  const ref = input.refDoc ?? null;

  let message = "";
  let data: Record<string, unknown> = {};
  let eventId = 0;

  try {
    await sql.begin(async (tx) => {
      switch (input.action) {
        case "lookup":
          message = `Identified ${sku.sku_code}`;
          break;

        case "inward": {
          const loc = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
          await adjustInventory(tx, sku.id, loc.warehouseId, loc.binId, batch, qty);
          await logMove(tx, sku.id, loc.warehouseId, loc.binId, "in", qty, ref ?? "SCAN-IN", input.user.id);
          message = `+${qty} ${sku.unit} received`;
          break;
        }

        case "outward":
        case "damage": {
          const loc = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
          const have = await qtyAt(tx, sku.id, loc.warehouseId, loc.binId, batch);
          if (have < qty) throw new Error(`Insufficient stock (have ${have}, need ${qty})`);
          await adjustInventory(tx, sku.id, loc.warehouseId, loc.binId, batch, -qty);
          await logMove(tx, sku.id, loc.warehouseId, loc.binId, input.action === "damage" ? "damage" : "out", qty, ref ?? "SCAN-OUT", input.user.id);
          message = input.action === "damage" ? `${qty} marked damaged/removed` : `-${qty} ${sku.unit} issued`;
          break;
        }

        case "transfer": {
          if (!input.toWarehouseId && !input.toBinId) throw new Error("Destination required for transfer");
          const from = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
          const have = await qtyAt(tx, sku.id, from.warehouseId, from.binId, batch);
          if (have < qty) throw new Error(`Insufficient stock to transfer (have ${have})`);
          const toWh = input.toWarehouseId ?? from.warehouseId;
          await adjustInventory(tx, sku.id, from.warehouseId, from.binId, batch, -qty);
          await adjustInventory(tx, sku.id, toWh, input.toBinId ?? 0, batch, qty);
          await logMove(tx, sku.id, from.warehouseId, from.binId, "transfer-out", qty, ref ?? "TRANSFER", input.user.id);
          await logMove(tx, sku.id, toWh, input.toBinId ?? 0, "transfer-in", qty, ref ?? "TRANSFER", input.user.id);
          message = `Transferred ${qty} ${sku.unit}`;
          break;
        }

        case "count": {
          const loc = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
          const have = await qtyAt(tx, sku.id, loc.warehouseId, loc.binId, batch);
          const counted = input.qty ?? 0;
          const delta = counted - have;
          if (delta !== 0) {
            await adjustInventory(tx, sku.id, loc.warehouseId, loc.binId, batch, delta);
            await logMove(tx, sku.id, loc.warehouseId, loc.binId, "count-adjust", delta, ref ?? "CYCLE-COUNT", input.user.id);
          }
          message = `Counted ${counted} (was ${have}, ${delta >= 0 ? "+" : ""}${delta})`;
          data = { counted, previous: have, delta };
          break;
        }

        case "pick":
        case "pack":
        case "dispatch":
        case "verify": {
          if (!ref) throw new Error("Sales order number required");
          const [so] = await tx`SELECT * FROM sales_orders WHERE so_no=${ref}`;
          if (!so) throw new Error(`Sales order ${ref} not found`);
          const soRow = so as { id: number; status: string };
          const [line] = await tx`SELECT * FROM so_lines WHERE so_id=${soRow.id} AND sku_id=${sku.id}`;
          if (!line) throw new Error(`${sku.sku_code} is not on order ${ref}`);
          const l = line as { id: number; qty: number; picked_qty: number; packed_qty: number; dispatched_qty: number };

          if (input.action === "verify") {
            message = `Verified ${sku.sku_code} against ${ref}`;
            data = { ordered: l.qty, dispatched: l.dispatched_qty };
          } else if (input.action === "pick") {
            if (l.picked_qty + qty > l.qty) throw new Error(`Pick exceeds ordered (${l.qty})`);
            await tx`UPDATE so_lines SET picked_qty=picked_qty+${qty} WHERE id=${l.id}`;
            message = `Picked ${qty} for ${ref}`;
          } else if (input.action === "pack") {
            if (l.packed_qty + qty > l.picked_qty) throw new Error(`Pack exceeds picked (${l.picked_qty})`);
            await tx`UPDATE so_lines SET packed_qty=packed_qty+${qty} WHERE id=${l.id}`;
            message = `Packed ${qty} for ${ref}`;
          } else {
            if (l.dispatched_qty + qty > l.qty) throw new Error(`Dispatch exceeds ordered (${l.qty})`);
            const loc = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
            const have = await qtyAt(tx, sku.id, loc.warehouseId, loc.binId, batch);
            if (have < qty) throw new Error(`Insufficient stock to dispatch (have ${have})`);
            await adjustInventory(tx, sku.id, loc.warehouseId, loc.binId, batch, -qty);
            await logMove(tx, sku.id, loc.warehouseId, loc.binId, "dispatch", qty, ref, input.user.id);
            await tx`UPDATE so_lines SET dispatched_qty=dispatched_qty+${qty} WHERE id=${l.id}`;
            message = `Dispatched ${qty} for ${ref}`;
          }

          if (input.action !== "verify") {
            const lines = (await tx`SELECT qty,picked_qty,packed_qty,dispatched_qty FROM so_lines WHERE so_id=${soRow.id}`) as unknown as
              Array<{ qty: number; picked_qty: number; packed_qty: number; dispatched_qty: number }>;
            const allDisp = lines.every((x) => x.dispatched_qty >= x.qty);
            const anyDisp = lines.some((x) => x.dispatched_qty > 0);
            const allPacked = lines.every((x) => x.packed_qty >= x.qty);
            const allPicked = lines.every((x) => x.picked_qty >= x.qty);
            let status = soRow.status;
            if (allDisp) status = "dispatched";
            else if (anyDisp) status = "partially dispatched";
            else if (allPacked) status = "packed";
            else if (allPicked) status = "picked";
            await tx`UPDATE sales_orders SET status=${status} WHERE id=${soRow.id}`;
            data = { ...data, orderStatus: status, ordered: l.qty };
          }
          break;
        }
        case "pack_case": {
          // Pack a scanned item into a numbered case for dispatch. Per the client's
          // chosen behaviour, stock is deducted immediately at pack (pack == ship).
          if (!ref) throw new Error("Sales order required");
          const caseNo = (input.packageNo ?? "").trim();
          if (!caseNo) throw new Error("Case number required");
          const [so] = await tx`SELECT * FROM sales_orders WHERE so_no=${ref}`;
          if (!so) throw new Error(`Sales order ${ref} not found`);
          const soRow = so as { id: number; status: string };
          const [line] = await tx`SELECT * FROM so_lines WHERE so_id=${soRow.id} AND sku_id=${sku.id}`;
          if (!line) throw new Error(`${sku.sku_code} is not on order ${ref}`);
          const l = line as { id: number; qty: number; packed_qty: number; dispatched_qty: number };
          const remaining = l.qty - l.packed_qty;
          if (remaining <= 0) throw new Error(`${sku.sku_code} already fully packed (${l.qty})`);
          if (qty > remaining) throw new Error(`Only ${remaining} left to pack for ${sku.sku_code}`);

          const loc = await resolveLoc(tx, sku.id, input.warehouseId, input.binId);
          const have = await qtyAt(tx, sku.id, loc.warehouseId, loc.binId, batch);
          if (have < qty) throw new Error(`Insufficient stock to pack (have ${have}, need ${qty})`);

          // find or create the case (one row per so + case number)
          let [pkg] = await tx`SELECT id FROM packages WHERE so_id=${soRow.id} AND package_no=${caseNo}`;
          if (!pkg) {
            [pkg] = await tx`
              INSERT INTO packages (so_id,package_no,status,created_by) VALUES (${soRow.id},${caseNo},'packed',${input.user.name})
              RETURNING id`;
          }
          const packageId = (pkg as { id: number }).id;

          await tx`INSERT INTO package_lines (package_id,so_id,so_line_id,sku_id,qty,packed_by)
                   VALUES (${packageId},${soRow.id},${l.id},${sku.id},${qty},${input.user.name})`;
          await adjustInventory(tx, sku.id, loc.warehouseId, loc.binId, batch, -qty);
          await logMove(tx, sku.id, loc.warehouseId, loc.binId, "pack-dispatch", qty, `${ref} / Case ${caseNo}`, input.user.id);
          await tx`UPDATE so_lines SET packed_qty=packed_qty+${qty}, dispatched_qty=dispatched_qty+${qty} WHERE id=${l.id}`;

          const lines = (await tx`SELECT qty,dispatched_qty FROM so_lines WHERE so_id=${soRow.id}`) as unknown as
            Array<{ qty: number; dispatched_qty: number }>;
          const allDisp = lines.every((x) => x.dispatched_qty >= x.qty);
          const anyDisp = lines.some((x) => x.dispatched_qty > 0);
          const status = allDisp ? "dispatched" : anyDisp ? "partially dispatched" : soRow.status;
          await tx`UPDATE sales_orders SET status=${status} WHERE id=${soRow.id}`;
          message = `Packed ${qty} ${sku.sku_code} into Case ${caseNo}`;
          data = { caseNo, packed: qty, remaining: remaining - qty, orderStatus: status, ordered: l.qty };
          break;
        }

        default:
          throw new Error(`Unsupported action: ${input.action}`);
      }

      eventId = await recordEvent(tx, {
        token, skuId: sku.id, user: input.user, action: input.action, qty,
        warehouseId: input.warehouseId, binId: input.binId, refDoc: ref, status: "success", device,
      });
    });

    return { ok: true, message, eventId, sku: await skuView(sku), data };
  } catch (e) {
    const error = (e as Error).message;
    const id = await recordEvent(sql, {
      token, skuId: sku.id, user: input.user, action: input.action, qty,
      warehouseId: input.warehouseId, binId: input.binId, refDoc: ref, status: "failure", error, device,
    });
    return { ok: false, message: "Scan rejected", error, eventId: id, sku: await skuView(sku) };
  }
}
