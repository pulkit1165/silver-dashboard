import "server-only";
import { getSql } from "./db";
import { logActivity } from "./activity";

/**
 * Shared, live "module-wise" process checklist — the SOP loop the whole team
 * (and the client) tick through together:
 *
 *   MRN → QC → Finished Goods → Sales Order → Packing/Scan → Pricing →
 *   Billing/PO calc → PO & Vendor selection → (loops back to MRN)
 *
 * Every stage holds sub-tasks. Everyone edits the SAME rows, so it stays in
 * sync across devices. Ticks/edits bump `updated_at`, which the whole-ERP live
 * fingerprint (lib/erp/packing-slips.ts → liveFingerprint) watches — so changes
 * push everywhere within ~2.5s WITHOUT flooding the Activity Feed. Only
 * structural changes (add/remove stage or task, reset) are written to the audit.
 *
 * Tables self-create on first use (idempotent, mirrors lib/erp/schema.ts) so
 * production migrates itself even before `npm run db:push` is run.
 */

let ensured: Promise<void> | null = null;
export function ensureChecklistTables(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS checklist_stages (
        id serial PRIMARY KEY,
        seq integer NOT NULL DEFAULT 0,
        title text NOT NULL,
        owner text DEFAULT '',
        tint text DEFAULT 'blue',
        description text DEFAULT '',
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        updated_at text DEFAULT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS')
      )`;
      await sql`CREATE TABLE IF NOT EXISTS checklist_tasks (
        id serial PRIMARY KEY,
        stage_id integer NOT NULL,
        seq integer NOT NULL DEFAULT 0,
        label text NOT NULL,
        done boolean DEFAULT false,
        done_by text,
        done_at text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        updated_at text DEFAULT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS')
      )`;
      await sql`CREATE INDEX IF NOT EXISTS checklist_task_stage_idx ON checklist_tasks (stage_id)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// ---- types the client component consumes ----
export interface ChecklistTask { id: number; label: string; done: boolean; doneBy: string | null; doneAt: string | null; }
export interface ChecklistStage {
  id: number; seq: number; title: string; owner: string; tint: string; description: string;
  tasks: ChecklistTask[];
}

// ---- the starter template (used only when the checklist is empty) ----
const DEFAULT_STAGES: { title: string; owner: string; tint: string; description: string; tasks: string[] }[] = [
  { title: "MRN — Material Receive Note", owner: "Stores / Receiving", tint: "blue",
    description: "Raw material / components physically arrive against a PO and are booked in.",
    tasks: ["Verify gate entry, vehicle & e-way bill", "Unload and count packages / cartons",
      "Match delivery challan qty vs PO qty", "Record supplier invoice / DC number",
      "Check visible transit damage & shortages", "Weigh / measure received goods",
      "Capture batch / lot / heat numbers", "Create MRN entry in ERP & get MRN no.",
      "Move stock to QUARANTINE bin (pending QC)", "Attach photos of received material",
      "Update inventory as 'received, awaiting QC'", "Flag short / excess / damaged qty",
      "Notify QC team to inspect", "File supplier documents / test certificates"] },
  { title: "Quality Check (QC)", owner: "Quality Dept", tint: "amber",
    description: "Inspect the quarantined material and accept, reject or send for rework.",
    tasks: ["Pull QC sample as per sampling plan", "Dimensional inspection vs drawing",
      "Material grade / spec verification", "Visual & surface finish inspection",
      "Fitment / functional test (bike part)", "Compare against approved golden sample",
      "Record measurements & tolerances", "Mark Accepted / Rejected / Rework qty",
      "Raise rejection note for defects", "Return rejected qty to vendor (debit note)",
      "Attach QC report / inspection certificate", "Update QC status in ERP",
      "Release accepted stock out of quarantine", "Notify stores & production of release"] },
  { title: "Packing & Transfer into Finished Goods", owner: "Production / Packing", tint: "teal",
    description: "QC-passed items are finished, labelled, packed and moved into sellable FG stock.",
    tasks: ["Move QC-passed items to packing line", "Assemble / finish / kit as required",
      "Apply barcode / QR label per unit", "Pack into single & master cartons",
      "Record master qty & single qty", "Weigh cartons (net & gross)",
      "Print & affix product label (MRP, HSN)", "Transfer to Finished-Goods warehouse",
      "Scan-in to confirm bin / rack location", "Update FG inventory (available-to-sell)",
      "Reconcile packed vs produced qty", "Post entry to stock ledger",
      "Mark items available for sales orders"] },
  { title: "Sales Order Punch", owner: "Sales", tint: "red",
    description: "Customer order captured (manual / AI decode / Excel) and confirmed into the queue.",
    tasks: ["Receive customer PO / order", "Verify customer master & GST details",
      "Check credit limit / outstanding", "Confirm FG stock availability",
      "Apply party discount / price scheme", "Enter line items, qty, rate, FOC",
      "Set bill type (K / O / O-K)", "Capture delivery address & terms",
      "Save as DRAFT sales order", "Get approval / confirm the order",
      "Assign SO number", "Send order confirmation to customer",
      "Route SO to warehouse picking queue"] },
  { title: "Packing Slip (order-wise) + Scanning", owner: "Warehouse / Dispatch", tint: "violet",
    description: "Order-wise packing slip created; goods picked, packed and dispatched by QR scan.",
    tasks: ["Generate packing slip for the SO", "Assign packing slip number",
      "Pick items by scanning QR (pick qty)", "Pack into cases by scan (case-wise)",
      "Record net wt / pack wt per case", "Validate packed vs ordered (block over-pack)",
      "Scan-dispatch (wrong-item / over-dispatch blocked)", "Deduct inventory on dispatch",
      "Verify Delivery Order (DO verify gate)", "Print packing slip & case labels",
      "Live-sync slip across all devices", "Save to Saved-Slips archive",
      "Hand over to transporter / update LR"] },
  { title: "Pricing Logic — Order Profitability", owner: "Sales / Costing", tint: "green",
    description: "Before billing, check each line and the whole order against target margin.",
    tasks: ["Pull cost / purchase price per line", "Pull selling / net rate per line",
      "Apply discount (class → party → SKU)", "Add freight & packing cost",
      "Compute gross margin per line", "Compute order-level profitability %",
      "Compare vs target margin threshold", "Flag below-margin lines for approval",
      "Get manager approval where needed", "Revise rate master if price changed",
      "Lock final pricing for billing"] },
  { title: "Billing + PO Calculation", owner: "Accounts", tint: "red",
    description: "GST invoice generated from verified dispatch; stock need & reorder PO qty computed.",
    tasks: ["Build invoice from verified DO qty", "Apply discount precedence",
      "Determine IGST vs CGST+SGST (state)", "Compute taxable, tax, round-off, grand total",
      "Review draft invoice", "Finalize & assign invoice number",
      "Advance invoiced qty on SO lines", "Print / email tax invoice (PDF)",
      "Post to receivables / finance", "Recompute stock vs min / reorder level",
      "Calculate PO qty for depleted materials", "(Later) e-Invoice IRN & e-Way bill"] },
  { title: "PO Shared → Vendor Selection", owner: "Purchase", tint: "blue",
    description: "Reorder PO / RFQ floated to vendors; quotes compared; best vendor selected — loops to MRN.",
    tasks: ["Generate reorder recommendations", "Create RFQ / draft PO",
      "Share PO / RFQ with multiple vendors", "Receive vendor quotations",
      "Compare price / lead time / terms", "Evaluate vendor rating & past history",
      "Select vendor(s)", "Negotiate & finalize rate",
      "Approve the PO", "Issue PO to selected vendor",
      "Track PO acknowledgement", "Schedule delivery → back to MRN (Stage 1)"] },
];

/** Insert the starter template — only runs when there are no stages yet. */
async function seedIfEmpty(): Promise<void> {
  const sql = getSql();
  const [{ n }] = (await sql`SELECT COUNT(*)::int n FROM checklist_stages`) as unknown as { n: number }[];
  if (n > 0) return;
  await sql.begin(async (tx) => {
    for (let s = 0; s < DEFAULT_STAGES.length; s++) {
      const d = DEFAULT_STAGES[s];
      const [stage] = await tx`
        INSERT INTO checklist_stages (seq, title, owner, tint, description)
        VALUES (${s + 1}, ${d.title}, ${d.owner}, ${d.tint}, ${d.description}) RETURNING id`;
      const stageId = (stage as { id: number }).id;
      for (let i = 0; i < d.tasks.length; i++) {
        await tx`INSERT INTO checklist_tasks (stage_id, seq, label) VALUES (${stageId}, ${i + 1}, ${d.tasks[i]})`;
      }
    }
  });
}

/** The whole checklist, stages ordered by seq with their tasks nested. */
export async function listChecklist(): Promise<ChecklistStage[]> {
  await ensureChecklistTables();
  await seedIfEmpty();
  const sql = getSql();
  const stages = (await sql`
    SELECT id, seq, title, owner, tint, description FROM checklist_stages ORDER BY seq, id`) as unknown as
    Omit<ChecklistStage, "tasks">[];
  const tasks = (await sql`
    SELECT id, stage_id, label, done, done_by, done_at FROM checklist_tasks ORDER BY seq, id`) as unknown as
    { id: number; stage_id: number; label: string; done: boolean; done_by: string | null; done_at: string | null }[];
  const byStage = new Map<number, ChecklistTask[]>();
  for (const t of tasks) {
    const arr = byStage.get(t.stage_id) ?? [];
    arr.push({ id: t.id, label: t.label, done: t.done, doneBy: t.done_by, doneAt: t.done_at });
    byStage.set(t.stage_id, arr);
  }
  return stages.map((s) => ({ ...s, owner: s.owner ?? "", description: s.description ?? "", tasks: byStage.get(s.id) ?? [] }));
}

/** A cheap stamp (latest write across both tables) — polled by the live fingerprint. */
export async function checklistStamp(): Promise<string> {
  const sql = getSql();
  const [r] = await sql`
    SELECT COALESCE((SELECT MAX(updated_at) FROM checklist_tasks),'') || '|'
        || COALESCE((SELECT MAX(updated_at) FROM checklist_stages),'') s`;
  return (r as { s: string }).s;
}

// ---------------- task mutations ----------------
export async function toggleTask(id: number, done: boolean, actor?: string | null): Promise<void> {
  await ensureChecklistTables();
  const sql = getSql();
  await sql`
    UPDATE checklist_tasks
       SET done=${done},
           done_by=${done ? (actor ?? null) : null},
           done_at=CASE WHEN ${done} THEN to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS') ELSE NULL END,
           updated_at=to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS')
     WHERE id=${id}`;
}

export async function editTaskLabel(id: number, label: string): Promise<void> {
  await ensureChecklistTables();
  await getSql()`
    UPDATE checklist_tasks SET label=${label}, updated_at=to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS') WHERE id=${id}`;
}

export async function addTask(stageId: number, label: string, actor?: string | null): Promise<ChecklistTask> {
  await ensureChecklistTables();
  const sql = getSql();
  const [{ next }] = (await sql`SELECT COALESCE(MAX(seq),0)+1 next FROM checklist_tasks WHERE stage_id=${stageId}`) as unknown as { next: number }[];
  const [row] = await sql`
    INSERT INTO checklist_tasks (stage_id, seq, label) VALUES (${stageId}, ${next}, ${label})
    RETURNING id, label, done, done_by, done_at`;
  const r = row as { id: number; label: string; done: boolean; done_by: string | null; done_at: string | null };
  await logActivity({ actor, action: "checklist.task.add", entity: "checklist_stage", entityId: stageId, summary: `Added task “${label}”` });
  return { id: r.id, label: r.label, done: r.done, doneBy: r.done_by, doneAt: r.done_at };
}

export async function deleteTask(id: number, actor?: string | null): Promise<void> {
  await ensureChecklistTables();
  const [row] = await getSql()`DELETE FROM checklist_tasks WHERE id=${id} RETURNING label, stage_id`;
  const r = row as { label: string; stage_id: number } | undefined;
  if (r) await logActivity({ actor, action: "checklist.task.delete", entity: "checklist_stage", entityId: r.stage_id, summary: `Removed task “${r.label}”` });
}

// ---------------- stage mutations ----------------
export async function editStage(id: number, patch: { title?: string; owner?: string; description?: string }): Promise<void> {
  await ensureChecklistTables();
  const sql = getSql();
  const cur = (await sql`SELECT title, owner, description FROM checklist_stages WHERE id=${id}`) as unknown as { title: string; owner: string; description: string }[];
  if (!cur.length) return;
  const c = cur[0];
  await sql`
    UPDATE checklist_stages
       SET title=${patch.title ?? c.title}, owner=${patch.owner ?? c.owner}, description=${patch.description ?? c.description},
           updated_at=to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS')
     WHERE id=${id}`;
}

export async function addStage(title: string, actor?: string | null): Promise<void> {
  await ensureChecklistTables();
  const sql = getSql();
  const [{ next }] = (await sql`SELECT COALESCE(MAX(seq),0)+1 next FROM checklist_stages`) as unknown as { next: number }[];
  const tints = ["blue", "amber", "teal", "red", "violet", "green"];
  await sql`INSERT INTO checklist_stages (seq, title, owner, tint) VALUES (${next}, ${title}, ${"Unassigned"}, ${tints[(next - 1) % tints.length]})`;
  await logActivity({ actor, action: "checklist.stage.add", entity: "checklist_stage", summary: `Added stage “${title}”` });
}

export async function deleteStage(id: number, actor?: string | null): Promise<void> {
  await ensureChecklistTables();
  const sql = getSql();
  const [row] = await sql`DELETE FROM checklist_stages WHERE id=${id} RETURNING title`;
  await sql`DELETE FROM checklist_tasks WHERE stage_id=${id}`;
  const r = row as { title: string } | undefined;
  if (r) await logActivity({ actor, action: "checklist.stage.delete", entity: "checklist_stage", entityId: id, summary: `Removed stage “${r.title}”` });
}

/** Wipe everything and re-seed the starter template. */
export async function resetChecklist(actor?: string | null): Promise<void> {
  await ensureChecklistTables();
  const sql = getSql();
  await sql`DELETE FROM checklist_tasks`;
  await sql`DELETE FROM checklist_stages`;
  await seedIfEmpty();
  await logActivity({ actor, action: "checklist.reset", entity: "checklist", summary: "Reset process checklist to the template" });
}
