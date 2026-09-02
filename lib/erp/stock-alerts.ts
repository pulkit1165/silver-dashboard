import "server-only";
import { getSql } from "./db";
import { stockStatus } from "./queries";
import { sendTemplate, logMessage } from "./whatsapp";
import { logActivity } from "./activity";
import type { StockStatus } from "./types";

// ── Proactive low-stock → WhatsApp alerts for the purchase dept ────────────
// Phase 2 of the WhatsApp agent (see WHATSAPP.md). Driven by a daily cron
// (app/api/cron/stock-alerts/route.ts). Alerts on skus.reorder_level — the
// field that literally exists for this — a slightly wider net than the ERP
// dashboard's "low stock" panel, which only checks min_stock.
//
// Cost control (Meta bills per 24h conversation, not per message): at most
// ONE template send per purchase contact per run, never one per SKU, and only
// when a SKU is newly breached / has worsened, or COOLDOWN_HOURS has passed
// since its last alert while still breached — so a healthy catalogue sends
// nothing, and a stuck shortage nags at most once a day. The template itself
// carries only a count; recipients reply to get the full list from the
// existing "Ask AI" WhatsApp bot, which is free (same 24h window it just opened).

const TEMPLATE_NAME = process.env.WHATSAPP_STOCK_ALERT_TEMPLATE ?? "low_stock_alert";
const TEMPLATE_LANG = process.env.WHATSAPP_STOCK_ALERT_LANG ?? "en";
const COOLDOWN_HOURS = 24;

const SEVERITY: Record<StockStatus, number> = { ok: 0, reorder: 1, low: 2, out: 3 };

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS stock_alert_state (
        sku_id integer PRIMARY KEY,
        status text NOT NULL DEFAULT 'ok',
        last_alerted_at timestamptz
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

type LowRow = { id: number; sku_code: string; name: string; min_stock: number; reorder_level: number; qty: number };
type Breached = LowRow & { status: StockStatus };

export type StockAlertResult = {
  breached: number;   // skus currently at/under reorder level
  toNotify: number;   // skus newly flagged, escalated, or due a re-nag this run
  recipients: number; // purchase-dept contacts messaged
  sent: number;
  failed: number;
  errors: string[];
};

export async function runStockAlertScan(): Promise<StockAlertResult> {
  await ensure();
  const sql = getSql();

  const rows = (await sql`
    SELECT s.id, s.sku_code, s.name, s.min_stock, s.reorder_level, COALESCE(inv.q,0)::float8 AS qty
      FROM skus s
      LEFT JOIN (SELECT sku_id, SUM(qty) q FROM inventory GROUP BY sku_id) inv ON inv.sku_id = s.id
     WHERE s.status = 'active' AND s.reorder_level > 0 AND COALESCE(inv.q,0) <= s.reorder_level
     ORDER BY COALESCE(inv.q,0) ASC, s.sku_code
  `) as unknown as LowRow[];
  const breached: Breached[] = rows.map((r) => ({ ...r, status: stockStatus(r, r.qty) }));

  if (breached.length === 0) return { breached: 0, toNotify: 0, recipients: 0, sent: 0, failed: 0, errors: [] };

  const ids = breached.map((r) => r.id);
  const stateRows = (await sql`
    SELECT sku_id, status, last_alerted_at FROM stock_alert_state WHERE sku_id = ANY(${ids})
  `) as unknown as Array<{ sku_id: number; status: StockStatus; last_alerted_at: string | null }>;
  const stateBySkuId = new Map(stateRows.map((r) => [r.sku_id, r]));

  const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const toNotify = breached.filter((r) => {
    const prev = stateBySkuId.get(r.id);
    if (!prev || prev.status === "ok") return true;
    if (SEVERITY[r.status] > SEVERITY[prev.status]) return true;
    const last = prev.last_alerted_at ? new Date(prev.last_alerted_at).getTime() : 0;
    return now - last >= cooldownMs;
  });
  const notifiedIds = new Set(toNotify.map((r) => r.id));

  // Persist current status for every breached sku; only bump last_alerted_at
  // for the ones actually notified this run.
  for (const r of breached) {
    if (notifiedIds.has(r.id)) {
      await sql`
        INSERT INTO stock_alert_state (sku_id, status, last_alerted_at) VALUES (${r.id}, ${r.status}, now())
        ON CONFLICT (sku_id) DO UPDATE SET status = EXCLUDED.status, last_alerted_at = now()`;
    } else {
      await sql`
        INSERT INTO stock_alert_state (sku_id, status) VALUES (${r.id}, ${r.status})
        ON CONFLICT (sku_id) DO UPDATE SET status = EXCLUDED.status`;
    }
  }
  // Clear anything that recovered back to 'ok' so a future dip alerts fresh.
  await sql`UPDATE stock_alert_state SET status = 'ok' WHERE status <> 'ok' AND sku_id <> ALL(${ids})`;

  if (toNotify.length === 0) return { breached: breached.length, toNotify: 0, recipients: 0, sent: 0, failed: 0, errors: [] };

  const contacts = (await sql`
    SELECT phone FROM whatsapp_contacts WHERE role = 'purchase' AND active = true AND opt_in = true
  `) as unknown as Array<{ phone: string }>;

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  const errors: string[] = [];
  let sent = 0, failed = 0;
  for (const c of contacts) {
    const result = await sendTemplate(c.phone, TEMPLATE_NAME, TEMPLATE_LANG, [String(toNotify.length), today]);
    await logMessage({
      direction: "out", phone: c.phone,
      body: `[template:${TEMPLATE_NAME}] ${toNotify.length} low-stock item(s)`,
      status: result.ok ? "sent" : "failed", error: result.error ?? null,
    });
    if (result.ok) sent++; else { failed++; errors.push(`${c.phone}: ${result.error}`); }
  }

  await logActivity({
    action: "whatsapp.stock_alert",
    entity: "sku",
    summary: `Low-stock WhatsApp alert: ${toNotify.length} item(s), sent to ${sent}/${contacts.length} purchase contact(s)`,
    meta: { skuIds: toNotify.map((r) => r.id), skuCodes: toNotify.map((r) => r.sku_code), sent, failed, errors },
  });

  return { breached: breached.length, toNotify: toNotify.length, recipients: contacts.length, sent, failed, errors };
}
