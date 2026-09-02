"use client";

import { useState } from "react";
import { GST_STATE_CODES } from "@/lib/erp/gst-states";
import type { CompanySettings } from "@/lib/erp/invoices";

export default function CompanySettingsForm({ initial }: { initial: CompanySettings }) {
  const [s, setS] = useState<CompanySettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 4000); };
  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => setS((cur) => ({ ...cur, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/erp/company-settings", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { flash(false, d.error || "Could not save."); return; }
      setS(d.settings);
      flash(true, "Saved.");
    } catch { flash(false, "Network error."); } finally { setBusy(false); }
  }

  const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";
  const lbl = "flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]";

  return (
    <section className="panel mb-5">
      <div className="panel-hd flex items-center justify-between">
        <span>Company Settings</span>
        {msg && <span className={`text-xs font-bold ${msg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</span>}
      </div>

      {!s.gstin && (
        <p className="mx-4 mt-3 rounded-lg border border-dashed border-[var(--danger)] bg-[var(--danger)]/5 p-2.5 text-xs font-semibold text-[var(--danger)]">
          GSTIN is not set — invoices are not legally valid until this is filled in and saved.
        </p>
      )}

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-extrabold uppercase text-[var(--muted)]">Registration</legend>
          <label className={lbl}>Legal name<input className={inp} value={s.legal_name} onChange={(e) => set("legal_name", e.target.value)} /></label>
          <label className={lbl}>Trade name (optional)<input className={inp} value={s.trade_name} onChange={(e) => set("trade_name", e.target.value)} /></label>
          <label className={lbl}>GSTIN<input className={inp} value={s.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="15-character GSTIN" maxLength={15} /></label>
          <label className={lbl}>Registered state (for IGST vs CGST/SGST)
            <select className={inp} value={s.state_code} onChange={(e) => set("state_code", e.target.value)}>
              <option value="">— select —</option>
              {GST_STATE_CODES.map((st) => <option key={st.code} value={st.code}>{st.code} — {st.name}</option>)}
            </select>
          </label>
          <label className={lbl}>MSME registration no. (optional)<input className={inp} value={s.msme_no} onChange={(e) => set("msme_no", e.target.value)} /></label>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-extrabold uppercase text-[var(--muted)]">Address & contact</legend>
          <label className={lbl}>Address<input className={inp} value={s.address} onChange={(e) => set("address", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>City<input className={inp} value={s.city} onChange={(e) => set("city", e.target.value)} /></label>
            <label className={lbl}>Pincode<input className={inp} value={s.pincode} onChange={(e) => set("pincode", e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Phone<input className={inp} value={s.phone} onChange={(e) => set("phone", e.target.value)} /></label>
            <label className={lbl}>Email<input className={inp} value={s.email} onChange={(e) => set("email", e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-extrabold uppercase text-[var(--muted)]">Bank details (printed on invoice)</legend>
          <label className={lbl}>Bank name<input className={inp} value={s.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Account no.<input className={inp} value={s.bank_account} onChange={(e) => set("bank_account", e.target.value)} /></label>
            <label className={lbl}>IFSC<input className={inp} value={s.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} /></label>
          </div>
          <label className={lbl}>Branch<input className={inp} value={s.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} /></label>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-extrabold uppercase text-[var(--muted)]">Invoicing & compliance</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Invoice prefix<input className={inp} value={s.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} /></label>
            <label className={lbl}>Next invoice no.<input type="number" className={inp} value={s.invoice_next_no} onChange={(e) => set("invoice_next_no", Number(e.target.value))} /></label>
          </div>
          <label className={lbl}>e-Way bill threshold (₹)
            <input type="number" className={inp} value={s.ewb_threshold} onChange={(e) => set("ewb_threshold", Number(e.target.value))} />
          </label>
          <label className={lbl}>Invoice terms / notes<textarea className={inp} rows={3} value={s.terms} onChange={(e) => set("terms", e.target.value)} /></label>
        </fieldset>
      </div>

      <div className="flex justify-end border-t border-[var(--border)] p-4">
        <button onClick={save} disabled={busy} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </section>
  );
}
