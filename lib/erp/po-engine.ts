import "server-only";
import { getSql } from "./db";

// ---- Types ---------------------------------------------------------------

export type PoConfig = {
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD'
  margin: number; // buffer % over demand (0–100)
  onlyNeeding: boolean;
};

export type Suggestion = {
  sku_id: number;
  sku_code: string;
  name: string;
  category: string;
  unit: string;
  on_hand: number;
  demand: number; // units sold in the reference window
  reorder_level: number;
  min_stock: number;
  suggested_qty: number;
  unit_cost: number; // purchase price (falls back to selling price if 0)
  est_cost: number; // suggested_qty * unit_cost
  cost_estimated: boolean; // true when unit_cost fell back to selling price
  status: "out" | "low" | "reorder" | "ok";
};

export type Recommendation = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  action: string;
  sku_code: string;
};

type Row = {
  id: number;
  sku_code: string;
  name: string;
  category: string;
  unit: string;
  purchase_price: number;
  selling_price: number;
  reorder_level: number;
  min_stock: number;
  vendor_id: number | null;
  on_hand: number;
  demand: number;
};

// ---- Core: pull the stock + demand picture for a window ------------------

async function loadRows(cfg: PoConfig): Promise<Row[]> {
  const sql = getSql();
  return (await sql`
    SELECT s.id, s.sku_code, s.name,
           COALESCE(s.category,'') AS category,
           COALESCE(s.unit,'PCS') AS unit,
           COALESCE(s.purchase_price,0)::float8 AS purchase_price,
           COALESCE(NULLIF(s.selling_price,0), s.price, 0)::float8 AS selling_price,
           COALESCE(s.reorder_level,0)::float8 AS reorder_level,
           COALESCE(s.min_stock,0)::float8 AS min_stock,
           s.vendor_id,
           COALESCE(inv.on_hand,0)::float8 AS on_hand,
           COALESCE(dem.demand,0)::float8 AS demand
    FROM skus s
    LEFT JOIN (SELECT sku_id, SUM(qty) AS on_hand FROM inventory GROUP BY sku_id) inv ON inv.sku_id = s.id
    LEFT JOIN (
      SELECT l.sku_id, SUM(l.qty) AS demand
      FROM so_lines l JOIN sales_orders o ON o.id = l.so_id
      WHERE o.order_date >= ${cfg.from} AND o.order_date <= ${cfg.to}
        AND o.status <> 'cancelled'
      GROUP BY l.sku_id
    ) dem ON dem.sku_id = s.id
    WHERE s.status = 'active'
  `) as unknown as Row[];
}

function stockStatus(onHand: number, minStock: number, reorder: number): Suggestion["status"] {
  if (onHand <= 0) return "out";
  if (onHand <= minStock) return "low";
  if (onHand <= reorder) return "reorder";
  return "ok";
}

/** Suggested order qty: cover projected demand (+margin buffer), never below reorder level. */
function suggestQty(r: Row, margin: number): number {
  const projected = r.demand * (1 + margin / 100);
  const target = Math.max(projected, r.reorder_level);
  return Math.max(0, Math.ceil(target - r.on_hand));
}

export async function generatePoSuggestions(cfg: PoConfig): Promise<{
  suggestions: Suggestion[];
  totals: { lines: number; units: number; cost: number; estimatedCost: boolean };
}> {
  const rows = await loadRows(cfg);

  let suggestions: Suggestion[] = rows.map((r) => {
    const qty = suggestQty(r, cfg.margin);
    const unitCost = r.purchase_price > 0 ? r.purchase_price : r.selling_price;
    return {
      sku_id: r.id,
      sku_code: r.sku_code,
      name: r.name,
      category: r.category,
      unit: r.unit,
      on_hand: r.on_hand,
      demand: r.demand,
      reorder_level: r.reorder_level,
      min_stock: r.min_stock,
      suggested_qty: qty,
      unit_cost: unitCost,
      est_cost: Math.round(qty * unitCost * 100) / 100,
      cost_estimated: r.purchase_price <= 0 && unitCost > 0,
      status: stockStatus(r.on_hand, r.min_stock, r.reorder_level),
    };
  });

  if (cfg.onlyNeeding) suggestions = suggestions.filter((s) => s.suggested_qty > 0);

  // Most urgent first: out/low/reorder by status, then by biggest shortfall.
  const rank = { out: 0, low: 1, reorder: 2, ok: 3 };
  suggestions.sort(
    (a, b) => rank[a.status] - rank[b.status] || b.suggested_qty - a.suggested_qty,
  );
  suggestions = suggestions.slice(0, 300); // safety cap for very large catalogues

  const totals = suggestions.reduce(
    (acc, s) => {
      acc.lines += 1;
      acc.units += s.suggested_qty;
      acc.cost += s.est_cost;
      if (s.cost_estimated) acc.estimatedCost = true;
      return acc;
    },
    { lines: 0, units: 0, cost: 0, estimatedCost: false },
  );
  totals.cost = Math.round(totals.cost * 100) / 100;

  return { suggestions, totals };
}

// ---- Heuristic ("Smart") recommendations --------------------------------

export async function smartRecommendations(cfg: PoConfig): Promise<Recommendation[]> {
  const rows = await loadRows(cfg);
  const recs: Recommendation[] = [];

  const out = rows.filter((r) => r.on_hand <= 0 && r.demand > 0);
  const low = rows.filter((r) => r.on_hand > 0 && r.on_hand <= r.min_stock);
  const reorder = rows.filter(
    (r) => r.on_hand > r.min_stock && r.on_hand <= r.reorder_level && r.reorder_level > 0,
  );
  const fastMovers = [...rows].filter((r) => r.demand > 0).sort((a, b) => b.demand - a.demand);
  const deadStock = rows.filter((r) => r.on_hand > 0 && r.demand === 0 && r.reorder_level === 0);
  const overstock = rows.filter(
    (r) => r.reorder_level > 0 && r.on_hand > r.reorder_level * 3 && r.demand === 0,
  );
  const noVendor = rows.filter((r) => r.vendor_id == null);
  const thinMargin = rows.filter(
    (r) => r.purchase_price > 0 && r.selling_price > 0 && r.selling_price <= r.purchase_price * 1.1,
  );

  // 1. Stockouts with live demand — most urgent.
  for (const r of out.sort((a, b) => b.demand - a.demand).slice(0, 4)) {
    const qty = suggestQty(r, cfg.margin);
    recs.push({
      severity: "high",
      title: `Out of stock — ${r.name}`,
      detail: `Sold ${r.demand} ${r.unit} in the reference window but on-hand is 0. You are losing fillable orders.`,
      action: `Raise a PO for ~${qty} ${r.unit} immediately.`,
      sku_code: r.sku_code,
    });
  }

  // 2. Below minimum stock.
  if (low.length) {
    const top = low.sort((a, b) => a.on_hand - b.on_hand)[0];
    recs.push({
      severity: "high",
      title: `${low.length} SKU${low.length > 1 ? "s" : ""} below minimum stock`,
      detail: `e.g. ${top.name} has only ${top.on_hand} ${top.unit} left (min ${top.min_stock}).`,
      action: "Review the Generate PO list and order the flagged items.",
      sku_code: top.sku_code,
    });
  }

  // 3. Approaching reorder level.
  if (reorder.length) {
    recs.push({
      severity: "medium",
      title: `${reorder.length} SKU${reorder.length > 1 ? "s" : ""} at reorder level`,
      detail: "Stock has dropped to the reorder threshold — replenish before it runs out.",
      action: `Order these now to avoid stockouts next cycle.`,
      sku_code: reorder[0].sku_code,
    });
  }

  // 4. Fast mover to prioritise.
  if (fastMovers.length) {
    const f = fastMovers[0];
    recs.push({
      severity: "medium",
      title: `Top seller this period — ${f.name}`,
      detail: `${f.demand} ${f.unit} sold; ${f.on_hand} on hand. Keep this line well-stocked.`,
      action: `Buffer ${cfg.margin}% above demand when ordering (~${suggestQty(f, cfg.margin)} ${f.unit}).`,
      sku_code: f.sku_code,
    });
  }

  // 5. Overstock / capital tied up.
  if (overstock.length) {
    const o = overstock.sort((a, b) => b.on_hand - a.on_hand)[0];
    recs.push({
      severity: "low",
      title: `${overstock.length} overstocked SKU${overstock.length > 1 ? "s" : ""}`,
      detail: `e.g. ${o.name}: ${o.on_hand} ${o.unit} on hand, no sales this period. Capital is tied up.`,
      action: "Pause ordering and consider a promotion to clear stock.",
      sku_code: o.sku_code,
    });
  }

  // 6. Dead stock.
  if (deadStock.length > 3) {
    recs.push({
      severity: "low",
      title: `${deadStock.length} SKUs with no movement`,
      detail: "These have on-hand stock but zero sales in the window and no reorder level set.",
      action: "Set reorder levels or review for clearance / return to vendor.",
      sku_code: deadStock[0].sku_code,
    });
  }

  // 7. Thin margins.
  if (thinMargin.length) {
    recs.push({
      severity: "medium",
      title: `${thinMargin.length} SKU${thinMargin.length > 1 ? "s" : ""} with thin margins`,
      detail: `e.g. ${thinMargin[0].name} sells at ≤10% over cost.`,
      action: "Renegotiate purchase price with the vendor or revisit selling price.",
      sku_code: thinMargin[0].sku_code,
    });
  }

  // 8. Vendor linkage gap (this catalogue has none linked).
  if (noVendor.length) {
    const pct = Math.round((noVendor.length / Math.max(rows.length, 1)) * 100);
    recs.push({
      severity: noVendor.length === rows.length ? "high" : "low",
      title: `${noVendor.length} SKU${noVendor.length > 1 ? "s" : ""} (${pct}%) have no vendor`,
      detail: "Without a default vendor, POs can't be grouped or auto-routed by supplier.",
      action: "Assign vendors on the SKU master to enable per-vendor PO automation.",
      sku_code: noVendor[0].sku_code,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}

/** Compact context the LLM uses to write its own recommendations. */
export async function recommendationContext(cfg: PoConfig) {
  const rows = await loadRows(cfg);
  const top = (arr: Row[], n: number) =>
    arr.slice(0, n).map((r) => ({
      sku_code: r.sku_code,
      name: r.name,
      on_hand: r.on_hand,
      demand: r.demand,
      reorder_level: r.reorder_level,
      min_stock: r.min_stock,
      purchase_price: r.purchase_price,
      selling_price: r.selling_price,
      has_vendor: r.vendor_id != null,
    }));

  return {
    window: { from: cfg.from, to: cfg.to, margin_pct: cfg.margin },
    totals: {
      active_skus: rows.length,
      out_of_stock: rows.filter((r) => r.on_hand <= 0).length,
      below_min: rows.filter((r) => r.on_hand > 0 && r.on_hand <= r.min_stock).length,
      no_vendor: rows.filter((r) => r.vendor_id == null).length,
    },
    needs_order: top(
      rows.filter((r) => suggestQty(r, cfg.margin) > 0).sort((a, b) => b.demand - a.demand),
      15,
    ),
    fast_movers: top([...rows].filter((r) => r.demand > 0).sort((a, b) => b.demand - a.demand), 8),
    overstock: top(
      rows.filter((r) => r.reorder_level > 0 && r.on_hand > r.reorder_level * 3 && r.demand === 0),
      6,
    ),
  };
}

export async function createPo(
  vendorId: number,
  lines: { skuId: number; qty: number; price: number }[],
  userId: number,
): Promise<{ poNo: string; total: number; lines: number }> {
  const sql = getSql();
  const clean = lines.filter((l) => l.skuId > 0 && l.qty > 0);
  if (clean.length === 0) throw new Error("No valid lines to order.");

  const total =
    Math.round(clean.reduce((s, l) => s + l.qty * (l.price || 0), 0) * 100) / 100;

  // PO number: PO-<next>. Existing seed uses PO-5xxx; continue from the max.
  const [{ next }] = (await sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(po_no, '\\D', '', 'g'), ''))::int, 5000) + 1 AS next
    FROM purchase_orders
  `) as unknown as { next: number }[];
  const poNo = `PO-${next}`;
  const today = new Date().toISOString().slice(0, 10);

  const [po] = (await sql`
    INSERT INTO purchase_orders (po_no, vendor_id, status, order_date, total)
    VALUES (${poNo}, ${vendorId}, 'draft', ${today}, ${total})
    RETURNING id
  `) as unknown as { id: number }[];
  const poId = (po as { id: number }).id;

  for (const l of clean) {
    await sql`INSERT INTO po_lines (po_id, sku_id, qty, price) VALUES (${poId}, ${l.skuId}, ${l.qty}, ${l.price || 0})`;
  }
  // Light audit trail (mirrors how the rest of the ERP logs activity).
  await sql`INSERT INTO notifications (role, type, message) VALUES ('purchase','po_created',${`${poNo} created (${clean.length} lines, ₹${total}) — awaiting approval`})`.catch(
    () => {},
  );

  return { poNo, total, lines: clean.length };
}
