// Shared types + pure formatting helpers for the Packing Slip,
// used by both the editor (PackingSlip.tsx) and the live big-screen view
// (PackingSlipLive.tsx) so the two never diverge.

export type Row = {
  id: string;
  itemCode: string; itemDesc: string; unit: string;
  mPack: string; mMrp: string; mrp: string; slipType: string;
  csNo: string; pcs: string; quantity: string;
  qtyOrdered: string; qtyDispatched: string; pendingQty: string;
};
export type Case = { caseNo: number; rows: Row[] };
export type Header = {
  slipNo: string; billNo: string; salesOrderNo: string; partyName: string; date: string;
  trType: string; trSno: string; remarks: string;
};
export type SlipDoc = { hdr: Header; activeCaseNo: number | null; activeRows: Row[]; completed: Case[] };
export type SlipMeta = { id: number; slip_no: string; party: string | null; updated_by: string | null; updated_at: string };

export const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-10" -> "10-Jun-26" to match the printed slip.
export const fmtDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1].slice(2)}` : (iso || ""); };

// The finished slip is item-wise (not case-wise): one line per item, quantity summed
// across every case, the cases it lives in shown in the "Case No" column, plus the
// order-line Qty Ordered / Qty Dispatched figures.
export type SlipItem = { code: string; desc: string; mrp: string; cases: number[]; qty: number; ordered: number; dispatched: number };
export function buildSlipItems(cases: Case[]): SlipItem[] {
  const map = new Map<string, SlipItem>();
  for (const c of cases) for (const r of c.rows) {
    const code = r.itemCode.trim() || "(blank)";
    const qty = num(r.quantity) || num(r.pcs);
    const ordered = num(r.qtyOrdered);
    const dispatched = num(r.qtyDispatched);
    const ex = map.get(code);
    if (ex) {
      ex.qty += qty;
      // Ordered/Dispatched are order-line figures (same on every case row) — keep the value, don't double-count.
      ex.ordered = Math.max(ex.ordered, ordered);
      ex.dispatched = Math.max(ex.dispatched, dispatched);
      if (!ex.cases.includes(c.caseNo)) ex.cases.push(c.caseNo);
      if (!ex.desc && r.itemDesc) ex.desc = r.itemDesc;
      if (!ex.mrp && (r.mrp || r.mMrp)) ex.mrp = r.mrp || r.mMrp;
    } else {
      map.set(code, { code, desc: r.itemDesc, mrp: r.mrp || r.mMrp, cases: [c.caseNo], qty, ordered, dispatched });
    }
  }
  const items = [...map.values()];
  items.forEach((it) => it.cases.sort((a, b) => a - b));
  // Group like the legacy slip: by the 2-digit part-category embedded in the code, then by code.
  const cat = (code: string) => { const m = /^[A-Za-z]{2}(\d{2})/.exec(code); return m ? +m[1] : 999; };
  items.sort((a, b) => cat(a.code) - cat(b.code) || a.code.localeCompare(b.code));
  return items;
}
// Lists the exact cases an item is packed in, joined with "-".
// e.g. cases 6 and 8 -> "6-8" (means case 6 AND case 8, not 7); a single case -> "9".
export function casesLabel(cases: number[]): string {
  return cases.join("-");
}
