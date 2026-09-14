import { NextResponse } from "next/server";
import type postgres from "postgres";
import { getSql, genToken } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import {
  MASTERS,
  parseRows,
  parsePairRows,
  detectColumns,
  type MasterConfig,
  type MasterKey,
  type ImportMode,
  type ParsedRow,
  type ParseError,
} from "@/lib/erp/masterImport";
import { ensurePricingTables } from "@/lib/erp/pricing-masters";
import { ensureAbbrevTable } from "@/lib/erp/skuAbbrev";

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

  // WHOLE-FILE guard: if the sheet's columns don't match this master (the key
  // column and at least one data column aren't detectable in the header), the file
  // is the wrong format — STOP the whole upload rather than silently do nothing or,
  // in full mode, delete everything. This is authoritative (dry-run and apply both).
  const det = detectColumns(cfg, rows);
  if (!det.keyFound || det.fieldsFound === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `This file doesn't match the ${cfg.label} — its columns weren't recognised, so nothing was changed. ` +
          `Expected columns like: ${cfg.sampleColumns.join(", ")}. ` +
          `Your file's columns: ${det.headers.length ? det.headers.join(", ") : "(none)"}.`,
      },
      { status: 400 },
    );
  }

  const sql = getSql();

  // Party × item net rate — two keys (party + item), resolved separately; handled
  // before parseRows (which assumes a single key column).
  if (cfg.kind === "pair-rate") {
    return handlePairRate(sql, cfg, rows, dryRun, user);
  }

  const { parsed, errors } = parseRows(cfg, rows);

  // Full overwrite with NOTHING valid parsed would delete/reset the entire master
  // (every existing row counts as "not in the file"). Refuse — the columns may
  // match but every row failed (e.g. a blank required field), and wiping the
  // master on a bad file is never the intent.
  if (mode === "full" && parsed.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Refusing full overwrite of ${cfg.label}: no valid rows were read from the file ` +
          `(${errors.length} row(s) had problems), so it would remove everything. ` +
          `Fix the file — or use Partial (merge) mode — and try again.`,
      },
      { status: 400 },
    );
  }

  if (cfg.kind === "rate") {
    return handleRate(sql, cfg, mode, parsed, errors, dryRun, user);
  }
  // Runtime tables aren't auto-created by the route — ensure this one exists first
  // (mirrors the pair-rate branch's ensurePricingTables()).
  if (cfg.key === "sku-abbrev") await ensureAbbrevTable();
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

// ─── Pair-rate master (party × item net rate) ─────────────────────────────────
// Appends a new net rate for each (party, item). Party is resolved by code OR
// name; item by code. A row whose party OR item can't be found is reported and
// skipped — the rest still apply. Append-only (versioned), so there's no "full
// overwrite" — every upload is a merge that adds the latest rate.
async function handlePairRate(
  sql: postgres.Sql,
  cfg: MasterConfig,
  rows: Record<string, unknown>[],
  dryRun: boolean,
  user: SessionUser,
) {
  await ensurePricingTables();
  const { pairs, errors } = parsePairRows(cfg, rows);

  // Resolve parties (by code, else exact name) and items (by code) once.
  const custRows = (await sql`SELECT id, code, name FROM customers`) as unknown as Array<{ id: number; code: string | null; name: string | null }>;
  const byCode = new Map<string, { id: number; code: string }>();
  const byName = new Map<string, { id: number; code: string }>();
  for (const r of custRows) {
    if (r.code) byCode.set(r.code.trim().toUpperCase(), { id: r.id, code: r.code });
    if (r.name) byName.set(r.name.trim().toUpperCase(), { id: r.id, code: r.code ?? "" });
  }
  const skuRows = (await sql`SELECT id, sku_code FROM skus`) as unknown as Array<{ id: number; sku_code: string }>;
  const skuByCode = new Map<string, { id: number; code: string }>();
  for (const r of skuRows) skuByCode.set(r.sku_code.trim().toUpperCase(), { id: r.id, code: r.sku_code });

  const notFound: ParseError[] = [];
  const matched: { cid: number; code: string; skuId: number; skuCode: string; rate: number }[] = [];
  for (const p of pairs) {
    const cust = byCode.get(p.party.toUpperCase()) ?? byName.get(p.party.toUpperCase());
    if (!cust) { notFound.push({ row: 0, key: `${p.party}/${p.sku_code}`, reason: `Party not found: ${p.party}` }); continue; }
    const sku = skuByCode.get(p.sku_code.toUpperCase());
    if (!sku) { notFound.push({ row: 0, key: `${p.party}/${p.sku_code}`, reason: `Item not found: ${p.sku_code}` }); continue; }
    matched.push({ cid: cust.id, code: cust.code, skuId: sku.id, skuCode: sku.code, rate: p.net_rate });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      master: cfg.key,
      label: cfg.label,
      mode: "partial",
      kind: "pair-rate",
      willUpdate: matched.length,
      notFound: notFound.length,
      errors: [...errors, ...notFound].slice(0, 300),
      sample: matched.slice(0, 6).map((m) => ({ party: m.code, sku_code: m.skuCode, net_rate: m.rate })),
    });
  }

  let updated = 0;
  for (const m of matched) {
    try {
      await sql`INSERT INTO party_item_net_rates (customer_id, code, sku_id, sku_code, net_rate, note, created_by)
        VALUES (${m.cid}, ${m.code}, ${m.skuId}, ${m.skuCode}, ${m.rate}, '', ${user.name})`;
      updated++;
    } catch (e) {
      errors.push({ row: 0, key: `${m.code}/${m.skuCode}`, reason: (e as Error).message });
    }
  }

  const allErrors = [...errors, ...notFound];
  await logActivity({
    actor: user.name,
    actorRole: user.role,
    action: `${cfg.action}.import`,
    entity: cfg.entity,
    summary: `Party × item net rate upload — ${updated} applied${notFound.length ? `, ${notFound.length} not found` : ""}`,
    meta: { updated, notFound: notFound.length, skipped: allErrors.length },
  });

  return NextResponse.json({
    ok: true,
    master: cfg.key,
    label: cfg.label,
    mode: "partial",
    kind: "pair-rate",
    updated,
    notFound: notFound.length,
    skipped: allErrors.length,
    errors: allErrors.slice(0, 300),
  });
}
