import "server-only";
import { getSql } from "./db";

// ── Self-hosted print bridge ────────────────────────────────────────────────
// A drop-in alternative to PrintNode. Flow:
//   1. The web app ENQUEUES a job (raw TSPL bytes, base64) into `print_jobs`.
//   2. A tiny agent on each ERP PC POLLS out over HTTPS, CLAIMS its jobs, prints
//      them raw to the local USB printer, and ACKs done/failed.
//   3. Agents also HEARTBEAT the printers they serve into `print_printers`, so the
//      app can list "online" bridge printers just like PrintNode's printer list.
// Because the agent polls outbound, there's no tunnel / port-forward / changing URL.

export type BridgePrinter = {
  id: string; pc: string; name: string; online: boolean; lastSeen: string;
  code: string; labelSize: string; locked: boolean;
};
export type BridgeJob = { id: number; name: string; tspl_b64: string };

const ONLINE_SECS = 40; // a printer is "online" if its agent heartbeat is this fresh

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS print_printers (
        id text PRIMARY KEY,
        pc text NOT NULL,
        name text NOT NULL,
        last_seen timestamptz NOT NULL DEFAULT now()
      )`;
      // Operator-set config: a friendly code (rename), the label size this printer
      // is loaded with, and a lock so only that size may print to it.
      await sql`ALTER TABLE print_printers
        ADD COLUMN IF NOT EXISTS code text DEFAULT '',
        ADD COLUMN IF NOT EXISTS label_size text DEFAULT '',
        ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false`;
      await sql`CREATE TABLE IF NOT EXISTS print_jobs (
        id bigserial PRIMARY KEY,
        printer_id text NOT NULL,
        pc text NOT NULL,
        name text NOT NULL,
        title text,
        tspl_b64 text NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        error text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        done_at timestamptz
      )`;
      await sql`CREATE INDEX IF NOT EXISTS print_jobs_claim ON print_jobs (pc, status, id)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const pidOf = (pc: string, name: string) => `${pc}::${name}`;

// Agent → register the printers it serves (called every ~10s).
export async function heartbeat(pc: string, names: string[]): Promise<void> {
  await ensure();
  const sql = getSql();
  for (const name of names) {
    if (!name) continue;
    await sql`INSERT INTO print_printers (id, pc, name, last_seen)
      VALUES (${pidOf(pc, name)}, ${pc}, ${name}, now())
      ON CONFLICT (id) DO UPDATE SET last_seen = now()`;
  }
}

// App → list online bridge printers for the printer dropdown / manager.
export async function listBridgePrinters(): Promise<BridgePrinter[]> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT id, pc, name, last_seen,
        COALESCE(code, '') AS code, COALESCE(label_size, '') AS label_size, COALESCE(locked, false) AS locked,
        (last_seen > now() - (${ONLINE_SECS} || ' seconds')::interval) AS online
      FROM print_printers ORDER BY code NULLS LAST, pc, name`) as unknown as
      { id: string; pc: string; name: string; last_seen: string; online: boolean; code: string; label_size: string; locked: boolean }[];
    return rows.map((r) => ({
      id: r.id, pc: r.pc, name: r.name, online: !!r.online, lastSeen: String(r.last_seen),
      code: r.code ?? "", labelSize: r.label_size ?? "", locked: !!r.locked,
    }));
  } catch { return []; }
}

// App → operator sets a printer's code (rename), label size, and lock.
export async function setPrinterConfig(
  id: string, cfg: { code?: string; labelSize?: string; locked?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  await ensure();
  const sql = getSql();
  const patch: Record<string, string | boolean> = {};
  if (typeof cfg.code === "string") patch.code = cfg.code.trim();
  if (typeof cfg.labelSize === "string") patch.label_size = cfg.labelSize.trim();
  if (typeof cfg.locked === "boolean") patch.locked = cfg.locked;
  const cols = Object.keys(patch);
  if (cols.length === 0) return { ok: false, error: "Nothing to update." };
  const [row] = (await sql`UPDATE print_printers SET ${sql(patch, ...cols)} WHERE id=${id} RETURNING id`) as unknown as { id: string }[];
  return row ? { ok: true } : { ok: false, error: "Printer not found." };
}

// App → enqueue one job per label (already-built TSPL, base64).
export async function enqueueJobs(
  printerId: string, jobs: { title: string; tspl_b64: string }[], actor?: string | null,
): Promise<number[]> {
  await ensure();
  const sep = printerId.indexOf("::");
  const pc = sep >= 0 ? printerId.slice(0, sep) : "";
  const name = sep >= 0 ? printerId.slice(sep + 2) : printerId;
  const sql = getSql();
  const ids: number[] = [];
  for (const j of jobs) {
    const rows = (await sql`INSERT INTO print_jobs (printer_id, pc, name, title, tspl_b64, created_by)
      VALUES (${printerId}, ${pc}, ${name}, ${j.title}, ${j.tspl_b64}, ${actor ?? null})
      RETURNING id`) as unknown as { id: number }[];
    ids.push(Number(rows[0].id));
  }
  return ids;
}

// Agent → atomically claim up to `limit` queued jobs for this PC (SKIP LOCKED so
// two agents / two polls never grab the same job).
export async function claimJobs(pc: string, limit = 5): Promise<BridgeJob[]> {
  await ensure();
  const rows = (await getSql()`
    UPDATE print_jobs SET status='printing', claimed_at=now()
    WHERE id IN (
      SELECT id FROM print_jobs WHERE pc=${pc} AND status='queued'
      ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, name, tspl_b64`) as unknown as BridgeJob[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name, tspl_b64: r.tspl_b64 }));
}

// Agent → report the outcome of a claimed job.
export async function ackJob(id: number, ok: boolean, error?: string): Promise<void> {
  await ensure();
  await getSql()`UPDATE print_jobs
    SET status=${ok ? "done" : "failed"}, error=${ok ? null : (error ?? "print failed")}, done_at=now()
    WHERE id=${id}`;
}

// App → poll statuses for the jobs it just enqueued (for the print-confirmation UI).
export async function jobStatuses(ids: number[]): Promise<Record<number, { status: string; error?: string }>> {
  if (!ids.length) return {};
  await ensure();
  const rows = (await getSql()`SELECT id, status, error FROM print_jobs WHERE id = ANY(${ids})`) as unknown as
    { id: number; status: string; error: string | null }[];
  const out: Record<number, { status: string; error?: string }> = {};
  for (const r of rows) out[Number(r.id)] = { status: r.status, error: r.error ?? undefined };
  return out;
}

// App → recent jobs for the Print Queue monitor.
export type JobRow = {
  id: number; printer_id: string; name: string; pc: string; status: string;
  error: string | null; created_at: string; done_at: string | null; created_by: string | null;
};
export async function listRecentJobs(limit = 60): Promise<JobRow[]> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT id, printer_id, name, pc, status, error, created_at, done_at, created_by
      FROM print_jobs ORDER BY id DESC LIMIT ${limit}`) as unknown as JobRow[];
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  } catch { return []; }
}
export async function queueCounts(): Promise<Record<string, number>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT status, count(*)::int AS n FROM print_jobs GROUP BY status`) as unknown as { status: string; n: number }[];
    const out: Record<string, number> = { queued: 0, printing: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  } catch { return { queued: 0, printing: 0, done: 0, failed: 0 }; }
}
// App → re-queue a failed/stuck job so an agent picks it up again.
export async function retryJob(id: number): Promise<void> {
  await ensure();
  await getSql()`UPDATE print_jobs SET status='queued', error=null, claimed_at=null, done_at=null
    WHERE id=${id} AND status IN ('failed','printing')`;
}

// Requeue jobs stuck in 'printing' longer than `secs` (agent died mid-print).
export async function requeueStale(secs = 120): Promise<number> {
  await ensure();
  const rows = (await getSql()`UPDATE print_jobs SET status='queued', claimed_at=null
    WHERE status='printing' AND claimed_at < now() - (${secs} || ' seconds')::interval
    RETURNING id`) as unknown as { id: number }[];
  return rows.length;
}
