import { NextResponse } from "next/server";
import type postgres from "postgres";
import { getSql, genToken } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import {
  MASTERS,
  parseRows,
  type MasterConfig,
  type MasterKey,
  type ImportMode,
  type ParsedRow,
  type ParseError,
} from "@/lib/erp/masterImport";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20000;

/**
 * Set of this master's ids that are referenced by any transactional table —
 * these are protected from deletion on a full overwrite.
 *
 * A referencing table that doesn't exist yet (some are created lazily / by a
 * later migration) simply contributes zero references, so we skip it. Any OTHER
 * error propagates so we never proceed to delete rows we couldn't verify.
 */
async function buildReferencedSet(sql: postgres.Sql, cfg: MasterConfig): Promise<Set<number>> {
  const set = new Set<number>();
  for (const ref of cfg.refs ?? []) {
    const q =
      `SELECT DISTINCT ${ref.col} AS id FROM ${ref.table} ` +
      `WHERE ${ref.col} IS NOT NULL${ref.where ? ` AND ${ref.where}` : ""}`;
    try {
      const rows = (await sql.unsafe(q)) as unknown as Array<{ id: number | null }>;
      for (const r of rows) if (r.id != null) set.add(Number(r.id));
    } catch (e) {
      // 42P01 = undefined_table. Nonexistent table ⇒ no references from it.
      if ((e as { code?: string }).code === "42P01") continue;
      throw e;
    }
  }
  return set;
}

/** Build the object to write for a new row (provided values + insert defaults). */
function insertObject(cfg: MasterConfig, p: ParsedRow): Record<string, string | number> {
  const obj: Record<string, string | number> = {};
  for (const c of p.providedCols) obj[c] = p.values[c];
  for (const f of cfg.fields) if (f.insertDefault != null && !(f.col in obj)) obj[f.col] = f.insertDefault;
  return obj;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    master?: string;
    mode?: string;
    rows?: unknown;
    dryRun?: boolean;
  };

  const cfg = body.master ? MASTERS[body.master as MasterKey] : undefined;
  if (!cfg) return NextResponse.json({ ok: false, error: "Unknown master." }, { status: 400 });
  if (!canWrite(user.role, cfg.permission)) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit ${cfg.label}.` }, { status: 403 });
  }

  const mode: ImportMode = body.mode === "full" ? "full" : "partial";
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  const dryRun = Boolean(body.dryRun);
  if (rows.length === 0) return NextResponse.json({ ok: false, error: "No rows provided." }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ ok: false, error: `Max ${MAX_ROWS} rows per upload.` }, { status: 400 });

  const sql = getSql();
  const { parsed, errors } = parseRows(cfg, rows);

  if (cfg.kind === "rate") {
    return handleRate(sql, cfg, mode, parsed, errors, dryRun, user);
  }
  return handleRow(sql, cfg, mode, parsed, errors, dryRun, user);
}

type SessionUser = { id: number; name: string; role: string };

// ─── Full-row masters (customers / vendors / skus) ────────────────────────────
async function handleRow(
  sql: postgres.Sql,
  cfg: MasterConfig,
  mode: ImportMode,
  parsed: ParsedRow[],
  errors: ParseError[],
  dryRun: boolean,
  user: SessionUser,
) {
  // Existing key -> id (case-insensitive on the key).
  const existRows = (await sql.unsafe(
    `SELECT id, ${cfg.keyCol} AS k FROM ${cfg.table}`,
  )) as unknown as Array<{ id: number; k: string | null }>;
  const existMap = new Map<string, number>();
  for (const r of existRows) if (r.k != null) existMap.set(String(r.k).toUpperCase(), r.id);

  const toInsert = parsed.filter((p) => !existMap.has(p.keyUpper));
  const toUpdate = parsed.filter((p) => existMap.has(p.keyUpper));

  // Full overwrite: rows not in the file are deletion candidates, unless
  // they're referenced by a transaction (then protected + kept).
  const deletable: { key: string; id: number }[] = [];
  const protectedRows: { key: string; id: number }[] = [];
  if (mode === "full") {
    const fileKeys = new Set(parsed.map((p) => p.keyUpper));
    const referenced = await buildReferencedSet(sql, cfg);
    for (const [k, id] of existMap.entries()) {
      if (fileKeys.has(k)) continue;
      if (referenced.has(id)) protectedRows.push({ key: k, id });
      else deletable.push({ key: k, id });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      master: cfg.key,
      label: cfg.label,
      mode,
      kind: "row",
      willInsert: toInsert.length,
      willUpdate: toUpdate.length,
      willDelete: deletable.length,
      willProtect: protectedRows.length,
      errors,
      sample: parsed.slice(0, 6).map((p) => ({ [cfg.keyCol]: p.keyStored, ...p.values })),
    });
  }

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  // Updates — only the columns actually present in the file are touched, so a
  // sparse sheet never wipes fields it didn't include.
  for (const p of toUpdate) {
    try {
      if (p.providedCols.length === 0) continue;
      const obj: Record<string, string | number> = {};
      for (const c of p.providedCols) obj[c] = p.values[c];
      await sql`UPDATE ${sql(cfg.table)} SET ${sql(obj, ...p.providedCols)} WHERE id = ${existMap.get(p.keyUpper)!}`;
      updated++;
    } catch (e) {
      errors.push({ row: 0, key: p.keyStored, reason: (e as Error).message });
    }
  }

  // Inserts.
  for (const p of toInsert) {
    try {
      if (cfg.mintsQr) {
        const obj = insertObject(cfg, p) as Record<string, string | number>;
        // MRP / net-rate coherence: mirror whichever price was supplied.
        if (obj.price == null && obj.selling_price != null) obj.price = obj.selling_price;
        if (obj.selling_price == null && obj.price != null) obj.selling_price = obj.price;
        const token = genToken();
        obj.sku_code = p.keyStored;
        obj.qr_token = token;
        const cols = Object.keys(obj);
        const [sku] = (await sql`INSERT INTO ${sql(cfg.table)} ${sql(obj, ...cols)} RETURNING id`) as unknown as Array<{ id: number }>;
        await sql`INSERT INTO qr_codes (sku_id, sku_code, token, tier, status, created_by)
                  VALUES (${sku.id}, ${p.keyStored}, ${token}, 'single', 'active', ${user.name})`;
      } else {
        const obj = insertObject(cfg, p);
        obj[cfg.keyCol] = p.keyStored;
        const cols = Object.keys(obj);
        await sql`INSERT INTO ${sql(cfg.table)} ${sql(obj, ...cols)}`;
      }
      inserted++;
    } catch (e) {
      errors.push({ row: 0, key: p.keyStored, reason: (e as Error).message });
    }
  }

  // Deletes (full mode) — unreferenced rows only; purge their child rows first.
  if (mode === "full") {
    for (const d of deletable) {
      try {
        for (const ch of cfg.cleanupChildren ?? []) {
          await sql`DELETE FROM ${sql(ch.table)} WHERE ${sql(ch.col)} = ${d.id}`;
        }
        await sql`DELETE FROM ${sql(cfg.table)} WHERE id = ${d.id}`;
        deleted++;
      } catch (e) {
        errors.push({ row: 0, key: d.key, reason: `Could not remove: ${(e as Error).message}` });
      }
    }
  }

  await logActivity({
    actor: user.name,
    actorRole: user.role,
    action: `${cfg.action}.import`,
    entity: cfg.entity,
    summary:
      `${mode === "full" ? "Full overwrite" : "Merge"} of ${cfg.label} — ` +
      [
        inserted && `${inserted} added`,
        updated && `${updated} updated`,
        deleted && `${deleted} removed`,
        protectedRows.length && `${protectedRows.length} protected`,
        errors.length && `${errors.length} skipped`,
      ]
        .filter(Boolean)
        .join(", "),
    meta: { mode, inserted, updated, deleted, protected: protectedRows.length, skipped: errors.length },
  });

  return NextResponse.json({
    ok: true,
    master: cfg.key,
    label: cfg.label,
    mode,
    kind: "row",
    inserted,
    updated,
    deleted,
    protectedCount: protectedRows.length,
    protectedSample: protectedRows.slice(0, 25).map((r) => r.key),
    skipped: errors.length,
    errors: errors.slice(0, 300),
  });
}

// ─── Rate masters (party discount % / item net rate) ─────────────────────────
async function handleRate(
  sql: postgres.Sql,
  cfg: MasterConfig,
  mode: ImportMode,
  parsed: ParsedRow[],
  errors: ParseError[],
  dryRun: boolean,
  user: SessionUser,
) {
  const rateCol = cfg.rateCol!;
  // Load every row so we can match on code OR name and count resets.
  const existRows = (await sql.unsafe(
    `SELECT id, ${cfg.keyCol} AS k, ${cfg.altKeyCol ?? cfg.keyCol} AS k2 FROM ${cfg.table}`,
  )) as unknown as Array<{ id: number; k: string | null; k2: string | null }>;
  const byKey = new Map<string, number>();
  const byAlt = new Map<string, number>();
  for (const r of existRows) {
    if (r.k != null) byKey.set(String(r.k).toUpperCase(), r.id);
    if (r.k2 != null) byAlt.set(String(r.k2).toUpperCase(), r.id);
  }
  const totalRows = existRows.length;

  const matched: { id: number; value: number }[] = [];
  const matchedIds = new Set<number>();
  const notFound: ParseError[] = [];
  for (const p of parsed) {
    const id = byKey.get(p.keyUpper) ?? byAlt.get(p.keyUpper);
    if (id == null) {
      notFound.push({ row: 0, key: p.keyStored, reason: "No matching record in the master" });
      continue;
    }
    if (matchedIds.has(id)) continue; // same record hit twice
    matchedIds.add(id);
    matched.push({ id, value: Number(p.values[rateCol]) || 0 });
  }

  const willReset = mode === "full" ? Math.max(0, totalRows - matchedIds.size) : 0;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      master: cfg.key,
      label: cfg.label,
      mode,
      kind: "rate",
      willUpdate: matched.length,
      willReset,
      notFound: notFound.length,
      errors: [...errors, ...notFound].slice(0, 300),
      sample: matched.slice(0, 6).map((m) => ({ id: m.id, [rateCol]: m.value })),
    });
  }

  let updated = 0;
  for (const m of matched) {
    try {
      await sql`UPDATE ${sql(cfg.table)} SET ${sql(rateCol)} = ${m.value} WHERE id = ${m.id}`;
      updated++;
    } catch (e) {
      errors.push({ row: 0, key: String(m.id), reason: (e as Error).message });
    }
  }

  let reset = 0;
  if (mode === "full") {
    const ids = [...matchedIds];
    const resetExpr = cfg.rateResetToCol
      ? sql`${sql(rateCol)} = ${sql(cfg.rateResetToCol)}`
      : sql`${sql(rateCol)} = ${cfg.rateResetValue ?? 0}`;
    try {
      const res = ids.length
        ? await sql`UPDATE ${sql(cfg.table)} SET ${resetExpr} WHERE id NOT IN ${sql(ids)}`
        : await sql`UPDATE ${sql(cfg.table)} SET ${resetExpr}`;
      reset = res.count;
    } catch (e) {
      errors.push({ row: 0, key: "*", reason: `Reset failed: ${(e as Error).message}` });
    }
  }

  const allErrors = [...errors, ...notFound];
  await logActivity({
    actor: user.name,
    actorRole: user.role,
    action: `${cfg.action}.import`,
    entity: cfg.entity,
    summary:
      `${mode === "full" ? "Full overwrite" : "Merge"} of ${cfg.label} — ` +
      [updated && `${updated} updated`, reset && `${reset} reset`, notFound.length && `${notFound.length} not found`]
        .filter(Boolean)
        .join(", "),
    meta: { mode, updated, reset, notFound: notFound.length },
  });

  return NextResponse.json({
    ok: true,
    master: cfg.key,
    label: cfg.label,
    mode,
    kind: "rate",
    updated,
    reset,
    notFound: notFound.length,
    skipped: allErrors.length,
    errors: allErrors.slice(0, 300),
  });
}
