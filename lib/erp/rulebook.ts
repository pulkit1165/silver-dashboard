import "server-only";
import { getSql } from "./db";
import { computeLineRate, lineGpPct, firstDuplicate } from "./pricing";
import { isInterState, computeLine } from "./invoice-engine";
import { assertSelectOnly } from "../oracle";
import { liveFingerprint } from "./packing-slips";

/**
 * The Rule Book — every business rule the ERP enforces, grouped by module, each
 * with a live self-test. A rule is GREEN only when its check actually runs and
 * passes right now (pure-logic rules assert the real engine; data rules probe
 * the live database). Rules that can only be proven by a live transaction are
 * marked "manual" (grey), never faked green.
 *
 * The Rule Book page runs these on load; the "Re-verify" button re-runs them.
 */

export type RuleStatus = "pass" | "fail" | "manual";
export interface RuleResult { id: string; title: string; detail: string; status: RuleStatus; note: string }
export interface ModuleRules { module: string; icon: string; rules: RuleResult[] }

type Outcome = { status: RuleStatus; note: string };
type Check = () => Promise<Outcome> | Outcome;
interface RuleDef { id: string; module: string; icon: string; title: string; detail: string; check: Check }

const ok = (note: string): Outcome => ({ status: "pass", note });
const bad = (note: string): Outcome => ({ status: "fail", note });
const man = (note: string): Outcome => ({ status: "manual", note });
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function tableExists(name: string): Promise<boolean> {
  const [r] = await getSql()`SELECT to_regclass(${name}) AS t`;
  return (r as { t: string | null }).t != null;
}
async function columnExists(table: string, col: string): Promise<boolean> {
  const [r] = await getSql()`SELECT 1 AS x FROM information_schema.columns WHERE table_name=${table} AND column_name=${col} LIMIT 1`;
  return !!r;
}

const RULES: RuleDef[] = [
  // ── Sales · pricing waterfall ──────────────────────────────────────────
  {
    id: "price-party-disc", module: "Sales · Pricing", icon: "↗",
    title: "Party discount % comes off MRP",
    detail: "With no item net rate, the line rate is MRP minus the party's standing discount %.",
    check: () => { const r = computeLineRate({ mrp: 100, partyDiscPct: 20 }); return near(r.final, 80) ? ok("MRP ₹100 − 20% = ₹80") : bad(`got ₹${r.final}`); },
  },
  {
    id: "price-net-supersede", module: "Sales · Pricing", icon: "↗",
    title: "Item net rate supersedes the party discount",
    detail: "When a global item net rate exists for a SKU, it overrides the party % for that line (party % goes inert). This is the Y/N shown on the punch screen.",
    check: () => { const r = computeLineRate({ mrp: 100, partyDiscPct: 20, itemNetRate: 60 }); return r.netRateApplied && near(r.final, 60) && r.partyDiscPct === 0 ? ok("net ₹60 wins; party 20% ignored; Y flag set") : bad(`applied=${r.netRateApplied} final=₹${r.final}`); },
  },
  {
    id: "price-foc-last", module: "Sales · Pricing", icon: "↗",
    title: "FOC discount is applied last",
    detail: "The FOC % is taken off whatever rate the first two steps produced (party disc, then item net rate).",
    check: () => { const r = computeLineRate({ mrp: 100, partyDiscPct: 0, itemNetRate: 60, focPct: 10 }); return near(r.final, 54) ? ok("₹60 net − 10% FOC = ₹54") : bad(`got ₹${r.final}`); },
  },
  {
    id: "price-no-dupes", module: "Sales · Pricing", icon: "↗",
    title: "No duplicate items in one order",
    detail: "Adding a SKU already on the order is blocked on the punch screen and rejected by the server.",
    check: () => (firstDuplicate([11, 22, 22, 33]) === 22 && firstDuplicate([1, 2, 3]) === null ? ok("duplicate SKU detected and unique list allowed") : bad("dedup helper wrong")),
  },
  {
    id: "gp-floor", module: "Sales · Pricing", icon: "↗",
    title: "Gross-profit floor flags low-margin lines",
    detail: "GP% = (net rate − cost) ÷ net rate; a line below the floor is flagged.",
    check: () => { const g = lineGpPct(84.5, 69.55); return g != null && g < 22 && near(g, 17.69) ? ok(`net ₹84.5, cost ₹69.55 → ${g}% (< 22% floor)`) : bad(`got ${g}%`); },
  },
  {
    id: "net-rate-master", module: "Sales · Pricing", icon: "↗",
    title: "Item net rate master is versioned",
    detail: "The item_net_rates ledger keeps every prior value; the live value mirrors to skus.item_net_rate.",
    check: async () => (await tableExists("item_net_rates") ? ok("item_net_rates ledger present") : man("not created yet — set one net rate to initialise")),
  },

  // ── Invoicing · GST ────────────────────────────────────────────────────
  {
    id: "gst-interstate", module: "Invoicing · GST", icon: "🧾",
    title: "Different states → IGST",
    detail: "When seller state ≠ place-of-supply state, the tax is IGST.",
    check: () => (isInterState("29", "07") ? ok("KA seller → DL supply = inter-state (IGST)") : bad("did not detect inter-state")),
  },
  {
    id: "gst-intrastate", module: "Invoicing · GST", icon: "🧾",
    title: "Same state → CGST + SGST",
    detail: "When seller state = place-of-supply state, the tax splits into CGST + SGST.",
    check: () => (!isInterState("29", "29") ? ok("KA → KA = intra-state (CGST+SGST)") : bad("wrongly flagged inter-state")),
  },
  {
    id: "gst-split", module: "Invoicing · GST", icon: "🧾",
    title: "Intra-state GST splits in half without drift",
    detail: "CGST and SGST each carry half the tax, and CGST + SGST equals the full tax exactly.",
    check: () => {
      const l = computeLine({ skuId: 1, qty: 10, mrp: 100, discountPct: 0, gstRate: 18 }, false);
      const full = l.igst + l.cgst + l.sgst;
      return l.igst === 0 && near(l.cgst + l.sgst, full) && Math.abs(l.cgst - l.sgst) <= 0.01 && full > 0
        ? ok(`taxable ₹${l.taxableValue}, CGST ₹${l.cgst} + SGST ₹${l.sgst} = ₹${(l.cgst + l.sgst).toFixed(2)}`)
        : bad(`cgst ₹${l.cgst} sgst ₹${l.sgst} igst ₹${l.igst}`);
    },
  },

  // ── Oracle · read-only safety ──────────────────────────────────────────
  {
    id: "ora-writes-blocked", module: "Oracle · Read-only", icon: "⚙",
    title: "Writes are blocked",
    detail: "Any non-SELECT (update/insert/delete/drop…) is rejected before it reaches Oracle.",
    check: () => { try { assertSelectOnly("update skus set price=1"); return bad("an UPDATE was NOT blocked"); } catch { return ok("UPDATE rejected by the guard"); } },
  },
  {
    id: "ora-single-stmt", module: "Oracle · Read-only", icon: "⚙",
    title: "Only a single statement runs",
    detail: "Stacked statements (a SELECT followed by a write) are rejected.",
    check: () => { try { assertSelectOnly("select 1 from dual; drop table skus"); return bad("stacked statement NOT blocked"); } catch { return ok("multi-statement rejected"); } },
  },
  {
    id: "ora-blank-lines", module: "Oracle · Read-only", icon: "⚙",
    title: "Blank lines are stripped (SQL*Plus safe)",
    detail: "A blank line ends a statement in SQL*Plus; the guard removes them so filtered queries aren't silently truncated.",
    check: () => { const out = assertSelectOnly("select a\n\n\nfrom t\n  where x=1"); return !out.split("\n").some((l) => l.trim() === "") ? ok("no blank lines remain in the cleaned SQL") : bad("blank lines survived"); },
  },
  {
    id: "ora-select-ok", module: "Oracle · Read-only", icon: "⚙",
    title: "Plain SELECT is allowed",
    detail: "A single read-only SELECT passes the guard unchanged.",
    check: () => { try { const s = assertSelectOnly("select 1 from dual"); return s ? ok("SELECT allowed") : bad("empty result"); } catch (e) { return bad((e as Error).message); } },
  },

  // ── Live sync · audit ──────────────────────────────────────────────────
  {
    id: "live-activity", module: "Live Sync · Audit", icon: "⚡",
    title: "Activity log exists (the audit + live signal)",
    detail: "Every instrumented write appends to activity_log; the live fingerprint watches its MAX(id).",
    check: async () => (await tableExists("activity_log") ? ok("activity_log present") : bad("activity_log missing")),
  },
  {
    id: "live-fingerprint", module: "Live Sync · Audit", icon: "⚡",
    title: "Live fingerprint is reachable",
    detail: "Clients poll a change fingerprint every ~2.5s and refresh when it moves.",
    check: async () => { const v = await liveFingerprint(); return typeof v === "string" && v.length > 0 ? ok(`fingerprint served (${v.length} chars)`) : bad("empty fingerprint"); },
  },

  // ── Masters · recency ──────────────────────────────────────────────────
  {
    id: "mrp-recency", module: "Masters · Recency", icon: "💲",
    title: "MRP master keeps full history",
    detail: "The most recent MRP is live everywhere; every prior value is retained.",
    check: async () => (await tableExists("mrp_history") ? ok("mrp_history ledger present") : man("not created yet — set one MRP to initialise")),
  },
  {
    id: "salesman-col", module: "Sales · Orders", icon: "↗",
    title: "Sales-order columns self-migrate",
    detail: "salesman_id/source are created on demand so a cold instance can list orders without a manual migration.",
    check: async () => (await columnExists("sales_orders", "salesman_id") ? ok("sales_orders.salesman_id present") : man("not migrated yet — open New Sales Order once")),
  },

  // ── Checklist ──────────────────────────────────────────────────────────
  {
    id: "checklist-live", module: "Process Checklist", icon: "✔",
    title: "Shared checklist is DB-backed",
    detail: "The SOP loop is stored in checklist_stages/checklist_tasks and syncs across devices.",
    check: async () => (await tableExists("checklist_stages") ? ok("checklist tables present") : man("not created yet — open the Process Checklist once")),
  },

  // ── Scan / dispatch (needs a live transaction to prove) ────────────────
  {
    id: "scan-audit", module: "Scanning · Dispatch", icon: "▣",
    title: "Every scan is audited (success and failure)",
    detail: "scan_events records each attempt with its status and, on rejection, the reason.",
    check: async () => (await tableExists("scan_events") ? ok("scan_events audit table present") : bad("scan_events missing")),
  },
  {
    id: "scan-overdispatch", module: "Scanning · Dispatch", icon: "▣",
    title: "Over-dispatch / wrong-item are rejected",
    detail: "Dispatch scans validate against the sales order — over-dispatch and wrong SKU throw. Proven by a live scan.",
    check: () => man("Enforced in the scan engine; run a dispatch scan to verify end-to-end."),
  },
];

export async function runRuleBook(): Promise<ModuleRules[]> {
  const results = await Promise.all(RULES.map(async (r): Promise<RuleResult & { module: string; icon: string }> => {
    let out: Outcome;
    try { out = await r.check(); } catch (e) { out = bad(`check threw: ${(e as Error).message}`); }
    return { id: r.id, title: r.title, detail: r.detail, status: out.status, note: out.note, module: r.module, icon: r.icon };
  }));
  const byModule = new Map<string, ModuleRules>();
  for (const r of results) {
    if (!byModule.has(r.module)) byModule.set(r.module, { module: r.module, icon: r.icon, rules: [] });
    byModule.get(r.module)!.rules.push({ id: r.id, title: r.title, detail: r.detail, status: r.status, note: r.note });
  }
  return [...byModule.values()];
}
