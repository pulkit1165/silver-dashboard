"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchSelect from "./SearchSelect";

interface SkuOption { id: number; sku_code: string; name: string; price: number; unit: string }
interface CustomerOption { id: number; code: string; name: string; discount_pct: number }
interface RateRow { trdate: string; partyName: string; itemCode: string; itemDescription: string; rate: number; quantity: number }

interface Line {
  skuId: number | null;
  qty: number;
  price: number;
  rateType: string;
  focQty: number;
  itemRates: RateRow[];
  partyRates: RateRow[];
  loadingRates: boolean;
}

const emptyLine = (): Line => ({
  skuId: null, qty: 1, price: 0, rateType: "MRP", focQty: 0,
  itemRates: [], partyRates: [], loadingRates: false,
});

export default function NewSalesOrder({ customers, skus }: { customers: CustomerOption[]; skus: SkuOption[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billType, setBillType] = useState("K");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const customer = customers.find((c) => c.id === customerId);
  // The party's locked discount %, from the Party-rate master (customers.discount_pct).
  const discPct = customer?.discount_pct ?? 0;
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.code })),
    [customers],
  );
  const skuOptions = useMemo(
    () => skus.map((s) => ({ value: s.id, label: s.name, sublabel: s.sku_code })),
    [skus],
  );

  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);

  // Pull an item's party-wise net-rate history from Oracle (read-only).
  async function loadRates(itemName: string, party: string | null): Promise<{ partyRates: RateRow[]; itemRates: RateRow[] }> {
    try {
      const params = new URLSearchParams({ item: itemName });
      if (party) params.set("party", party);
      const r = await fetch(`/api/erp/rates?${params}`);
      const d = await r.json();
      return { partyRates: d.ok ? d.partyRates ?? [] : [], itemRates: d.ok ? d.itemRates ?? [] : [] };
    } catch {
      return { partyRates: [], itemRates: [] };
    }
  }

  // When the party changes, re-price every existing line for that party: for
  // each item, the Rate Type (NET/MRP) and net rate are auto-fetched from the
  // party-wise net-rate file (NET if the party has a rate for it, else MRP).
  useEffect(() => {
    if (!customer) return;
    const party = customer.name;
    const d = customer.discount_pct ?? 0;
    let cancelled = false;
    const snapshot = linesRef.current;
    setLines((ls) => ls.map((l) => {
      const sku = l.skuId ? skuById.get(l.skuId) : undefined;
      return sku ? { ...l, loadingRates: true } : l;
    }));
    snapshot.forEach((l, idx) => {
      if (!l.skuId) return;
      const sku = skuById.get(l.skuId);
      if (!sku) return;
      loadRates(sku.name, party).then(({ partyRates, itemRates }) => {
        if (cancelled) return;
        updateLine(idx, { ...deriveRate(sku.price, partyRates, d), partyRates, itemRates, loadingRates: false });
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function onSkuChange(idx: number, skuId: number) {
    const sku = skuById.get(skuId);
    if (!sku) { updateLine(idx, { skuId, price: 0, rateType: "MRP", loadingRates: false, itemRates: [], partyRates: [] }); return; }
    // optimistic MRP default while we fetch the party-wise rate for this item
    updateLine(idx, { skuId, ...deriveRate(sku.price, [], discPct), loadingRates: true, itemRates: [], partyRates: [] });
    const { partyRates, itemRates } = await loadRates(sku.name, customer?.name ?? null);
    updateLine(idx, { ...deriveRate(sku.price, partyRates, discPct), partyRates, itemRates, loadingRates: false });
  }

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  async function submit() {
    setErr("");
    if (!customerId) { setErr("Select a customer."); return; }
    const validLines = lines.filter((l) => l.skuId && l.qty > 0);
    if (validLines.length === 0) { setErr("Add at least one item."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/erp/sales-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          order_date: orderDate,
          bill_type: billType,
          disc_pct: discPct,
          remarks,
          lines: validLines.map((l) => {
            const sku = skuById.get(l.skuId as number);
            const mrp = sku?.price ?? l.price;
            const discountPct = mrp > 0 ? round2((1 - l.price / mrp) * 100) : 0;
            return {
              sku_id: l.skuId, qty: l.qty, price: l.price,
              mrp, discount_pct: discountPct, rate_type: l.rateType, foc_qty: l.focQty,
            };
          }),
        }),
      });
      const d = await r.json();
      if (d.ok) router.push(`/erp/sales/${d.order.id}`);
      else setErr(d.error ?? "Failed to create order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <F label="Customer *">
          <SearchSelect
            options={customerOptions}
            value={customerId}
            onChange={setCustomerId}
            placeholder="Search customer…"
            className={inp}
          />
        </F>
        <F label="Order date">
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inp} />
        </F>
        <F label="Bill Type">
          <select value={billType} onChange={(e) => setBillType(e.target.value)} className={inp}>
            <option value="K">K</option>
            <option value="O">O</option>
            <option value="O/K">O/K</option>
          </select>
        </F>
        <F label="Discount % (locked · from Party master)">
          <div className={`${inp} flex items-center justify-between bg-[var(--surface-2)]`} title="Set per party in Master Files → Party-wise Net Rate">
            <span className="font-bold">{discPct.toFixed(2)}%</span>
            <span className="text-[10px] font-semibold uppercase text-[var(--muted-2)]">🔒 auto</span>
          </div>
        </F>
        <F label="Remarks">
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inp} placeholder="Optional" />
        </F>
      </div>

      {customer && (
        <div className="text-sm">
          {discPct > 0 ? (
            <span className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-semibold text-[var(--accent)]">
              {customer.name}: {discPct.toFixed(2)}% off MRP — auto-applied to every line.
              <span className="font-normal text-[var(--muted)]"> Change it in Master Files → Party-wise Net Rate.</span>
            </span>
          ) : (
            <span className="text-[var(--muted)]">No discount set for {customer.name} in the Party master — lines default to full MRP. Set it in Master Files → Party-wise Net Rate.</span>
          )}
        </div>
      )}

      <div className="space-y-3">
        {lines.map((line, idx) => {
          const sku = line.skuId ? skuById.get(line.skuId) : undefined;
          return (
            <div key={idx} className="rounded-xl border border-[var(--border)] p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-9 sm:items-end">
                <div className="sm:col-span-2">
                  <F label="Item">
                    <SearchSelect
                      options={skuOptions}
                      value={line.skuId}
                      onChange={(id) => onSkuChange(idx, id)}
                      placeholder="Search item…"
                      className={inp}
                    />
                  </F>
                </div>
                <F label="MRP">
                  <div className={`${inp} bg-[var(--surface-2)]`}>{sku ? sku.price.toFixed(2) : "—"}</div>
                </F>
                <F label="Disc %">
                  <div className={`${inp} bg-[var(--surface-2)]`} title="Party discount % — same for every item (from the Party master)">
                    {discPct ? `${discPct.toFixed(2)}%` : "—"}
                  </div>
                </F>
                <F label="Net rate">
                  <input
                    type="number" step="0.01" value={line.price}
                    onChange={(e) => updateLine(idx, { price: Number(e.target.value) || 0 })}
                    className={inp}
                  />
                </F>
                <F label="Qty">
                  <input
                    type="number" min={1} value={line.qty}
                    onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                    className={inp}
                  />
                </F>
                <F label="Rate Type">
                  <div
                    className={`${inp} bg-[var(--surface-2)] font-bold ${line.rateType === "NET" ? "text-[var(--accent)]" : ""}`}
                    title="Auto: NET if the party has a net rate for this item (party-wise net-rate file), else MRP"
                  >
                    {line.loadingRates ? "…" : (line.rateType || "—")}
                  </div>
                </F>
                <F label="FOC Qty">
                  <input
                    type="number" min={0} value={line.focQty}
                    onChange={(e) => updateLine(idx, { focQty: Number(e.target.value) || 0 })}
                    className={inp}
                    title="Free of cost / promotional quantity"
                  />
                </F>
                <div className="flex items-end justify-between gap-2">
                  <div className="text-sm font-bold">₹{(line.qty * line.price).toFixed(2)}</div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                      className="text-xs font-semibold text-[var(--danger)]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {sku && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  {line.loadingRates ? (
                    "Checking Oracle history for past rates…"
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {discPct > 0 && (
                        <Suggestion
                          label={`MRP rate (${discPct.toFixed(2)}% off)`}
                          rate={round2(sku.price * (1 - discPct / 100))}
                          date="MRP"
                          onUse={() => updateLine(idx, { price: round2(sku.price * (1 - discPct / 100)), rateType: "MRP" })}
                        />
                      )}
                      {line.partyRates.length > 0 && (
                        <Suggestion
                          label={`${customer?.name ?? "This party"} net rate`}
                          rate={line.partyRates[0].rate}
                          date={line.partyRates[0].trdate.slice(0, 10)}
                          onUse={() => updateLine(idx, { price: line.partyRates[0].rate, rateType: "NET" })}
                        />
                      )}
                      {line.itemRates.length > 0 && (
                        <Suggestion
                          label="Recent market rate (any party)"
                          rate={line.itemRates[0].rate}
                          date={line.itemRates[0].trdate.slice(0, 10)}
                          onUse={() => updateLine(idx, { price: line.itemRates[0].rate, rateType: "NET" })}
                        />
                      )}
                      {discPct === 0 && line.partyRates.length === 0 && line.itemRates.length === 0 && (
                        <span>No party discount set and no Oracle history for this item.</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setLines((ls) => [...ls, emptyLine()])}
        className="text-sm font-semibold text-[var(--accent)] hover:underline"
      >
        + Add item
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <div className="text-base font-bold">Order total: ₹{total.toFixed(2)}</div>
        <div className="flex items-center gap-3">
          {err && <span className="text-sm font-semibold text-[var(--danger)]">{err}</span>}
          <button
            disabled={busy}
            onClick={submit}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create Sales Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Suggestion({ label, rate, date, onUse }: { label: string; rate: number; date: string; onUse: () => void }) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 hover:border-[var(--accent)]"
    >
      {label}: <span className="font-bold">₹{rate.toFixed(2)}</span>{" "}
      <span className="text-[var(--muted-2)]">({date})</span>
    </button>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Per item, decide Rate Type + net rate from the party-wise net-rate file:
// if the party has a net rate for this item → NET (use it); otherwise → MRP
// (MRP minus the party's locked discount %).
function deriveRate(mrp: number, partyRates: RateRow[], discPct: number): { price: number; rateType: string } {
  if (partyRates.length > 0) return { price: round2(partyRates[0].rate), rateType: "NET" };
  return { price: round2(mrp * (1 - discPct / 100)), rateType: "MRP" };
}

const inp =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">{label}{children}</label>;
}
