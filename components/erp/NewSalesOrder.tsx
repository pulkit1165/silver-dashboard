"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface SkuOption { id: number; sku_code: string; name: string; price: number; unit: string }
interface CustomerOption { id: number; code: string; name: string }
interface RateRow { trdate: string; partyName: string; itemCode: string; itemDescription: string; rate: number; quantity: number }
interface PartyDiscount { discountPct: number; asOfDate: string }

interface Line {
  skuId: number | null;
  qty: number;
  price: number;
  itemRates: RateRow[];
  partyRates: RateRow[];
  loadingRates: boolean;
}

const emptyLine = (): Line => ({ skuId: null, qty: 1, price: 0, itemRates: [], partyRates: [], loadingRates: false });

export default function NewSalesOrder({ customers, skus }: { customers: CustomerOption[]; skus: SkuOption[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | "">("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [partyDiscount, setPartyDiscount] = useState<PartyDiscount | null>(null);
  const [loadingDiscount, setLoadingDiscount] = useState(false);

  const customer = customers.find((c) => c.id === customerId);
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  // The legacy app's actual pricing logic: each customer carries a standing
  // discount % (stored on their most recent order header, by GST slab) that
  // gets applied to every item's MRP. Pull it the moment a customer is
  // picked, so new lines can default to the same net rate automatically.
  useEffect(() => {
    setPartyDiscount(null);
    if (!customer) return;
    let cancelled = false;
    setLoadingDiscount(true);
    fetch(`/api/erp/party-discount?party=${encodeURIComponent(customer.name)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPartyDiscount(d.ok ? d.discount ?? null : null); })
      .catch(() => { if (!cancelled) setPartyDiscount(null); })
      .finally(() => { if (!cancelled) setLoadingDiscount(false); });
    return () => { cancelled = true; };
  }, [customer]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function onSkuChange(idx: number, skuId: number) {
    const sku = skuById.get(skuId);
    const mrp = sku?.price ?? 0;
    const defaultPrice = sku && partyDiscount ? round2(mrp * (1 - partyDiscount.discountPct / 100)) : mrp;
    updateLine(idx, { skuId, price: defaultPrice, loadingRates: !!sku, itemRates: [], partyRates: [] });
    if (!sku) return;
    try {
      const params = new URLSearchParams({ item: sku.name });
      if (customer) params.set("party", customer.name);
      const r = await fetch(`/api/erp/rates?${params}`);
      const d = await r.json();
      updateLine(idx, { itemRates: d.ok ? d.itemRates ?? [] : [], partyRates: d.ok ? d.partyRates ?? [] : [], loadingRates: false });
    } catch {
      updateLine(idx, { loadingRates: false });
    }
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
          lines: validLines.map((l) => ({ sku_id: l.skuId, qty: l.qty, price: l.price })),
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <F label="Customer *">
          <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value) || "")} className={inp}>
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </F>
        <F label="Order date">
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inp} />
        </F>
      </div>

      {customer && (
        <div className="text-sm">
          {loadingDiscount ? (
            <span className="text-[var(--muted)]">Checking {customer.name}&rsquo;s standing discount in Oracle…</span>
          ) : partyDiscount ? (
            <span className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-semibold text-[var(--accent)]">
              Standing discount: {partyDiscount.discountPct.toFixed(2)}% off MRP
              <span className="font-normal text-[var(--muted)]"> (from order on {partyDiscount.asOfDate.slice(0, 10)}) — auto-applied to new lines below</span>
            </span>
          ) : (
            <span className="text-[var(--muted)]">No standing discount found for {customer.name} in Oracle — new lines default to full MRP.</span>
          )}
        </div>
      )}

      <div className="space-y-3">
        {lines.map((line, idx) => {
          const sku = line.skuId ? skuById.get(line.skuId) : undefined;
          return (
            <div key={idx} className="rounded-xl border border-[var(--border)] p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
                <F label="Item">
                  <select value={line.skuId ?? ""} onChange={(e) => onSkuChange(idx, Number(e.target.value))} className={inp}>
                    <option value="">Select item…</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.sku_code})</option>
                    ))}
                  </select>
                </F>
                <F label="MRP">
                  <div className={`${inp} bg-[var(--surface-2)]`}>{sku ? sku.price.toFixed(2) : "—"}</div>
                </F>
                <F label="Qty">
                  <input
                    type="number" min={1} value={line.qty}
                    onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                    className={inp}
                  />
                </F>
                <F label="Net rate">
                  <input
                    type="number" step="0.01" value={line.price}
                    onChange={(e) => updateLine(idx, { price: Number(e.target.value) || 0 })}
                    className={inp}
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
                  ) : !partyDiscount && line.itemRates.length === 0 && line.partyRates.length === 0 ? (
                    <span>No Oracle sales history found for this item.</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {partyDiscount && (
                        <Suggestion
                          label={`Standing discount (${partyDiscount.discountPct.toFixed(2)}% off MRP)`}
                          rate={round2(sku.price * (1 - partyDiscount.discountPct / 100))}
                          date={partyDiscount.asOfDate.slice(0, 10)}
                          onUse={() => updateLine(idx, { price: round2(sku.price * (1 - partyDiscount.discountPct / 100)) })}
                        />
                      )}
                      {line.partyRates.length > 0 && (
                        <Suggestion
                          label={`${customer?.name ?? "This party"} last paid`}
                          rate={line.partyRates[0].rate}
                          date={line.partyRates[0].trdate.slice(0, 10)}
                          onUse={() => updateLine(idx, { price: line.partyRates[0].rate })}
                        />
                      )}
                      {line.itemRates.length > 0 && (
                        <Suggestion
                          label="Recent market rate (any party)"
                          rate={line.itemRates[0].rate}
                          date={line.itemRates[0].trdate.slice(0, 10)}
                          onUse={() => updateLine(idx, { price: line.itemRates[0].rate })}
                        />
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

const inp =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">{label}{children}</label>;
}
