"use client";

import { useState } from "react";
import Scanner from "./Scanner";

type WH = { id: number; code: string; name: string };
type BIN = { id: number; warehouse_id: number; code: string };
type Loc = { warehouse_code?: string; bin_code?: string; qty: number };
type SkuView = {
  id: number; sku_code: string; name: string; category: string; brand: string; unit: string;
  qty: number; status: string; min_stock: number; reorder_level: number; qr_token: string;
  locations?: Loc[];
};
type OpenOrder = { so_no: string; status: string; invoice_no: string | null; qty: number; dispatched_qty: number };
type Validated = { token: string; sku: SkuView; openOrders: OpenOrder[] };

type ActionDef = { key: string; label: string; icon: string; needs: ("qty" | "loc" | "dest" | "ref")[]; write: boolean };

const ACTIONS: ActionDef[] = [
  { key: "lookup", label: "View details", icon: "🔍", needs: [], write: false },
  { key: "inward", label: "Stock inward", icon: "⬇", needs: ["qty", "loc"], write: true },
  { key: "outward", label: "Stock outward", icon: "⬆", needs: ["qty", "loc"], write: true },
  { key: "transfer", label: "Transfer", icon: "⇄", needs: ["qty", "loc", "dest"], write: true },
  { key: "count", label: "Cycle count", icon: "#", needs: ["qty", "loc"], write: true },
  { key: "pick", label: "Pick (SO)", icon: "✋", needs: ["qty", "ref"], write: true },
  { key: "pack", label: "Pack (SO)", icon: "📦", needs: ["qty", "ref"], write: true },
  { key: "dispatch", label: "Dispatch (SO)", icon: "🚚", needs: ["qty", "loc", "ref"], write: true },
  { key: "damage", label: "Report damage", icon: "⚠", needs: ["qty", "loc"], write: true },
  { key: "verify", label: "Verify vs SO", icon: "✓", needs: ["ref"], write: false },
];

const STATUS_TAG: Record<string, string> = { out: "r", low: "r", reorder: "n", ok: "g" };

export default function ScanWorkspace({
  user, canWrite, warehouses, bins,
}: {
  user: { name: string; role: string };
  canWrite: boolean;
  warehouses: WH[];
  bins: BIN[];
}) {
  const [validated, setValidated] = useState<Validated | null>(null);
  const [action, setAction] = useState<ActionDef | null>(null);
  const [qty, setQty] = useState(1);
  const [whId, setWhId] = useState<number>(warehouses[0]?.id ?? 0);
  const [binId, setBinId] = useState<number>(0);
  const [toWhId, setToWhId] = useState<number>(warehouses[0]?.id ?? 0);
  const [toBinId, setToBinId] = useState<number>(0);
  const [refDoc, setRefDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; error?: string; eventId?: number } | null>(null);

  async function handleDetect(code: string) {
    setResult(null);
    setAction(null);
    setBusy(true);
    try {
      const r = await fetch("/api/erp/scan/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, device: "web" }),
      });
      const data = await r.json();
      if (data.ok) {
        setValidated({ token: data.token, sku: data.sku, openOrders: data.openOrders ?? [] });
        if (data.openOrders?.[0]) setRefDoc(data.openOrders[0].so_no);
      } else {
        setValidated(null);
        setResult({ ok: false, message: "Scan rejected", error: data.error });
      }
    } catch {
      setResult({ ok: false, message: "Network error", error: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  function pickAction(a: ActionDef) {
    setResult(null);
    setAction(a);
    setQty(a.key === "count" ? validated?.sku.qty ?? 0 : 1);
  }

  async function confirm() {
    if (!validated || !action) return;
    setBusy(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        code: validated.token, action: action.key, device: "web",
      };
      if (action.needs.includes("qty")) body.qty = qty;
      if (action.needs.includes("loc")) { body.warehouseId = whId; if (binId) body.binId = binId; }
      if (action.needs.includes("dest")) { body.toWarehouseId = toWhId; if (toBinId) body.toBinId = toBinId; }
      if (action.needs.includes("ref")) body.refDoc = refDoc;
      const r = await fetch("/api/erp/scan/action", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await r.json();
      setResult(data);
      if (data.ok && data.sku) {
        setValidated((v) => (v ? { ...v, sku: { ...v.sku, ...data.sku } } : v));
        setAction(null);
      }
    } catch {
      setResult({ ok: false, message: "Network error", error: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setValidated(null);
    setAction(null);
    setResult(null);
  }

  const binsFor = (w: number) => bins.filter((b) => b.warehouse_id === w);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* scanner */}
      <section className="panel">
        <div className="panel-hd">Camera</div>
        <div className="p-4">
          <Scanner onDetect={handleDetect} />
          <p className="mt-3 text-xs text-[var(--muted)]">
            Signed in as <b>{user.name}</b> ({user.role}). On phones the camera needs HTTPS — the
            type/paste box works anywhere for testing.
          </p>
        </div>
      </section>

      {/* result / actions */}
      <section className="panel">
        <div className="panel-hd">Result &amp; Actions</div>
        <div className="flex flex-col gap-4 p-4">
          {result && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                borderColor: result.ok ? "var(--accent-2)" : "var(--danger)",
                background: result.ok ? "var(--accent-2-bg)" : "var(--danger-bg)",
                color: result.ok ? "var(--accent-2)" : "var(--danger)",
              }}
            >
              <div className="font-extrabold">{result.ok ? "✓ " + result.message : "✕ " + (result.error ?? result.message)}</div>
              {result.eventId && <div className="mt-0.5 text-xs opacity-80">Audit event #{result.eventId} recorded</div>}
            </div>
          )}

          {!validated && !result && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
              {busy ? "Validating…" : "Scan or enter a QR code to identify a SKU."}
            </div>
          )}

          {validated && (
            <>
              <div className="rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-extrabold">{validated.sku.name}</div>
                    <div className="font-mono text-xs text-[var(--muted)]">{validated.sku.sku_code} · {validated.sku.category}</div>
                  </div>
                  <span className={`tag ${STATUS_TAG[validated.sku.status] ?? "n"}`}>{validated.sku.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>On hand: <b className="tabular-nums">{validated.sku.qty}</b> {validated.sku.unit}</span>
                  <span className="text-[var(--muted)]">Min {validated.sku.min_stock} · Reorder {validated.sku.reorder_level}</span>
                </div>
                {validated.sku.locations && validated.sku.locations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {validated.sku.locations.map((l, i) => (
                      <span key={i} className="tag n">{l.warehouse_code}/{l.bin_code}: {l.qty}</span>
                    ))}
                  </div>
                )}
                {validated.openOrders.length > 0 && (
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    Open orders: {validated.openOrders.map((o) => `${o.so_no} (${o.dispatched_qty}/${o.qty})`).join(", ")}
                  </div>
                )}
              </div>

              {/* action grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ACTIONS.map((a) => {
                  const locked = a.write && !canWrite;
                  return (
                    <button
                      key={a.key}
                      disabled={locked}
                      onClick={() => pickAction(a)}
                      className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-colors ${
                        action?.key === a.key
                          ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-strong)]"
                          : locked
                          ? "cursor-not-allowed border-[var(--border)] text-[var(--muted-2)] opacity-60"
                          : "border-[var(--border)] hover:bg-[var(--surface-2)]"
                      }`}
                      title={locked ? "Your role can't perform this action" : ""}
                    >
                      <span className="mr-1">{a.icon}</span>
                      {a.label}
                      {locked && " 🔒"}
                    </button>
                  );
                })}
              </div>

              {/* action form */}
              {action && (
                <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                  <div className="text-sm font-extrabold">{action.icon} {action.label}</div>
                  <div className="grid grid-cols-2 gap-3">
                    {action.needs.includes("qty") && (
                      <Field label={action.key === "count" ? "Counted qty" : "Quantity"}>
                        <input type="number" min={0} value={qty}
                          onChange={(e) => setQty(Number(e.target.value))} className={inputCls} />
                      </Field>
                    )}
                    {action.needs.includes("ref") && (
                      <Field label="Sales order">
                        {validated.openOrders.length > 0 ? (
                          <select value={refDoc} onChange={(e) => setRefDoc(e.target.value)} className={inputCls}>
                            {validated.openOrders.map((o) => <option key={o.so_no} value={o.so_no}>{o.so_no}</option>)}
                          </select>
                        ) : (
                          <input value={refDoc} onChange={(e) => setRefDoc(e.target.value)} placeholder="SO-1001" className={inputCls} />
                        )}
                      </Field>
                    )}
                    {action.needs.includes("loc") && (
                      <>
                        <Field label="Warehouse">
                          <select value={whId} onChange={(e) => { setWhId(Number(e.target.value)); setBinId(0); }} className={inputCls}>
                            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                          </select>
                        </Field>
                        <Field label="Bin (optional)">
                          <select value={binId} onChange={(e) => setBinId(Number(e.target.value))} className={inputCls}>
                            <option value={0}>Auto</option>
                            {binsFor(whId).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                          </select>
                        </Field>
                      </>
                    )}
                    {action.needs.includes("dest") && (
                      <>
                        <Field label="To warehouse">
                          <select value={toWhId} onChange={(e) => { setToWhId(Number(e.target.value)); setToBinId(0); }} className={inputCls}>
                            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                          </select>
                        </Field>
                        <Field label="To bin (optional)">
                          <select value={toBinId} onChange={(e) => setToBinId(Number(e.target.value))} className={inputCls}>
                            <option value={0}>Auto</option>
                            {binsFor(toWhId).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                          </select>
                        </Field>
                      </>
                    )}
                  </div>
                  <button
                    onClick={confirm}
                    disabled={busy}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
                  >
                    {busy ? "Working…" : `Confirm ${action.label}`}
                  </button>
                </div>
              )}

              <button onClick={reset} className="self-start text-xs font-semibold text-[var(--accent)] underline">
                ↺ Scan another item
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
      {label}
      {children}
    </label>
  );
}
