"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { MasterMeta, MasterKey, ImportMode } from "@/lib/erp/masterImport";

type Row = Record<string, unknown>;
type Err = { row: number; key: string; reason: string };

interface Preview {
  kind: "row" | "rate" | "pair-rate" | "pair";
  willInsert?: number;
  willUpdate?: number;
  willDelete?: number;
  willProtect?: number;
  willReset?: number;
  notFound?: number;
  errors: Err[];
}
interface Result {
  kind: "row" | "rate" | "pair-rate" | "pair";
  inserted?: number;
  updated?: number;
  deleted?: number;
  protectedCount?: number;
  protectedSample?: string[];
  reset?: number;
  notFound?: number;
  skipped?: number;
  errors: Err[];
}

export default function MasterUpload({
  masters,
  initialMaster,
}: {
  masters: MasterMeta[];
  initialMaster?: MasterKey;
}) {
  const [master, setMaster] = useState<MasterKey>(initialMaster ?? masters[0].key);
  const [mode, setMode] = useState<ImportMode>("partial");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const [confirmText, setConfirmText] = useState("");
  // Single-entry "add one" form (no file) — reuses the import route with one row.
  const [single, setSingle] = useState<Record<string, string>>({});
  const [singleMsg, setSingleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [singleBusy, setSingleBusy] = useState(false);

  const meta = useMemo(() => masters.find((m) => m.key === master)!, [masters, master]);

  function reset() {
    setPreview(null);
    setResult(null);
    setConfirmText("");
  }

  function ingest(wb: XLSX.WorkBook) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
    setRows(data);
    reset();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    ingest(XLSX.read(buf, { type: "array" }));
  }

  function onPaste(text: string) {
    if (!text.trim()) {
      setRows([]);
      reset();
      return;
    }
    setFileName("pasted data");
    ingest(XLSX.read(text, { type: "string" }));
  }

  async function run(dryRun: boolean) {
    if (rows.length === 0) return;
    setBusy(dryRun ? "Validating…" : "Applying…");
    try {
      const r = await fetch("/api/erp/masters/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ master, mode, rows, dryRun }),
      });
      const d = await r.json();
      if (!d.ok) {
        alert(d.error || "Failed");
        return;
      }
      if (dryRun) {
        setPreview(d as Preview);
        setResult(null);
      } else {
        setResult(d as Result);
        setPreview(null);
      }
    } finally {
      setBusy("");
    }
  }

  // Add ONE entry (no file): send a single row through the same import route in
  // partial mode — so it validates, skips-and-reports the same way, and (for row
  // masters) creates a new record or updates the existing one matched by key.
  async function submitSingle() {
    const obj: Record<string, string> = {};
    for (const f of meta.formFields) {
      const v = (single[f.col] ?? "").trim();
      if (v !== "") obj[f.col] = v;
    }
    const missing = meta.formFields.filter((f) => f.required && !(f.col in obj));
    if (missing.length) {
      setSingleMsg({ ok: false, text: `Please fill: ${missing.map((m) => m.label).join(", ")}` });
      return;
    }
    setSingleBusy(true);
    setSingleMsg(null);
    try {
      const r = await fetch("/api/erp/masters/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ master, mode: "partial", rows: [obj], dryRun: false }),
      });
      const d = await r.json();
      if (!d.ok) {
        setSingleMsg({ ok: false, text: d.error || "Failed" });
        return;
      }
      const applied = (d.inserted ?? 0) + (d.updated ?? 0);
      if (applied > 0) {
        const what = (d.inserted ?? 0) > 0 ? "added" : "updated";
        setSingleMsg({ ok: true, text: `${meta.label}: entry ${what} ✓` });
        setSingle({});
      } else {
        const reason = d.errors?.[0]?.reason;
        setSingleMsg({ ok: false, text: reason ? `Skipped — ${reason}` : "No change was made." });
      }
    } catch {
      setSingleMsg({ ok: false, text: "Network error." });
    } finally {
      setSingleBusy(false);
    }
  }

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const isPair = meta.kind === "pair-rate" || meta.kind === "pair"; // party×item — append-only, no full overwrite
  const isFull = !isPair && mode === "full";
  const isSku = master === "skus";
  const applyReady = !!preview && (!isFull || confirmText.trim().toUpperCase() === "OVERWRITE");

  return (
    <div className="flex flex-col gap-5">
      {/* 1 — pick master + mode */}
      <section className="panel">
        <div className="panel-hd">1 · Choose master &amp; mode</div>
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Master file
            <select
              value={master}
              onChange={(e) => {
                const k = e.target.value as MasterKey;
                setMaster(k);
                { const kk = masters.find((m) => m.key === k)?.kind; if (kk === "pair-rate" || kk === "pair") setMode("partial"); }
                setRows([]);
                setFileName("");
                setSingle({});
                setSingleMsg(null);
                reset();
              }}
              className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {masters.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {isPair ? (
            <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
              {meta.kind === "pair"
                ? <>This master <b>always merges</b> — each upload records the party+item assignment (safe to re-upload). Rows for a party or item that doesn&apos;t exist are reported and skipped; the rest still go through.</>
                : <>This master <b>always appends</b> — each upload adds the latest net rate for every party+item in the file (a versioned history is kept). Rows for a party or item that doesn&apos;t exist are reported and skipped; the rest still go through.</>}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                active={mode === "partial"}
                onClick={() => {
                  setMode("partial");
                  reset();
                }}
                title="Partial (half) — merge"
                desc="Add rows that are new and update the ones in the file (matched by code). Everything else stays exactly as it is."
                tone="safe"
              />
              <ModeCard
                active={mode === "full"}
                onClick={() => {
                  setMode("full");
                  reset();
                }}
                title="Full overwrite — replace"
                desc={
                  meta.kind === "rate"
                    ? "The file becomes the complete rate list. Every record NOT in the file has its rate reset to default."
                    : "The master becomes exactly the file. Rows not in the file are removed — except any still used by an order/invoice/stock move, which are kept."
                }
                tone="danger"
              />
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
            <b>Expected columns</b> (any order; extra columns ignored, header names auto-detected):{" "}
            <span className="font-mono">{meta.sampleColumns.join(", ")}</span>.
            <br />
            Match key: <b>{meta.keyLabel}</b>.
            {meta.kind === "row" && " Only the columns present in your file are changed on existing rows."}
          </div>
        </div>
      </section>

      {/* Add ONE entry (no file) */}
      <section className="panel">
        <div className="panel-hd">Add a single entry (no file)</div>
        <div className="flex flex-col gap-3 p-4">
          <div className="text-xs text-[var(--muted)]">
            Type one {meta.label.toLowerCase()} entry and save it. Matched by <b>{meta.keyLabel}</b> —
            {meta.kind === "row"
              ? " a new code is added; an existing code is updated."
              : meta.kind === "pair-rate"
                ? " the party and item must already exist; the net rate is added."
                : meta.kind === "pair"
                  ? " the party and item must already exist; the assignment is recorded."
                  : " the record must already exist; its rate is set."}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {meta.formFields.map((f) => (
              <label key={f.col} className="flex flex-col gap-1 text-xs font-semibold">
                {f.label}
                {f.required && <span className="text-[var(--danger)]"> *</span>}
                <input
                  value={single[f.col] ?? ""}
                  onChange={(e) => setSingle((s) => ({ ...s, [f.col]: e.target.value }))}
                  type={f.type === "num" ? "number" : "text"}
                  step={f.type === "num" ? "any" : undefined}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={submitSingle}
              disabled={singleBusy}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              {singleBusy ? "Saving…" : "Save entry"}
            </button>
            {singleMsg && (
              <span className="text-sm font-bold" style={{ color: singleMsg.ok ? "var(--accent-2)" : "var(--danger)" }}>
                {singleMsg.text}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 2 — upload / paste */}
      <section className="panel">
        <div className="panel-hd">Or bulk upload / paste</div>
        <div className="flex flex-col gap-3 p-4">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFile}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:font-bold file:text-white"
          />
          <div className="text-xs text-[var(--muted)]">Accepts Excel (.xlsx / .xls) or CSV.</div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-[var(--accent)]">…or paste rows (CSV)</summary>
            <textarea
              onChange={(e) => onPaste(e.target.value)}
              placeholder={meta.sampleColumns.join(",")}
              className="mt-2 h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs outline-none focus:border-[var(--accent)]"
            />
          </details>
        </div>
      </section>

      {/* 3 — preview rows */}
      {rows.length > 0 && (
        <section className="panel">
          <div className="panel-hd">
            3 · File preview ({rows.length} rows from {fileName})
          </div>
          <div className="overflow-x-auto p-1">
            <table className="rtable">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h}>{String(r[h] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && <div className="p-2 text-xs text-[var(--muted)]">…and {rows.length - 8} more</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-3">
            <button
              onClick={() => run(true)}
              disabled={!!busy}
              className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]"
            >
              {busy === "Validating…" ? busy : "Validate"}
            </button>
            {!preview && <span className="text-xs text-[var(--muted)]">Validate first to see exactly what will change.</span>}
          </div>
        </section>
      )}

      {/* 4 — validation result + apply */}
      {preview && !result && (
        <section className="panel">
          <div className="panel-hd">4 · What will change</div>
          <div className="flex flex-col gap-3 p-4">
            {preview.kind === "row" ? (
              <div className="flex flex-wrap gap-2">
                <Stat n={preview.willInsert ?? 0} label="added" tone="accent2" />
                <Stat n={preview.willUpdate ?? 0} label="updated" tone="accent" />
                {isFull && <Stat n={preview.willDelete ?? 0} label="removed" tone="danger" />}
                {isFull && <Stat n={preview.willProtect ?? 0} label="protected (kept)" tone="muted" />}
                <Stat n={preview.errors.length} label="skipped" tone="muted" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Stat n={preview.willUpdate ?? 0} label={preview.kind === "pair" ? "assignments" : "rates updated"} tone="accent" />
                {isFull && <Stat n={preview.willReset ?? 0} label="reset to default" tone="danger" />}
                <Stat n={preview.notFound ?? 0} label="not found" tone="muted" />
              </div>
            )}

            {isFull && (
              <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg,#fff1f0)] p-3 text-sm">
                <p className="font-bold text-[var(--danger)]">
                  ⚠ Full overwrite of {meta.label}.
                  {preview.kind === "row"
                    ? ` ${preview.willDelete ?? 0} record(s) will be permanently removed.`
                    : ` ${preview.willReset ?? 0} record(s) will have their rate reset.`}
                </p>
                {isSku && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    This is your real item catalogue. Items used on any order, invoice, or stock move are automatically
                    protected and kept.
                  </p>
                )}
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                  Type <span className="font-mono text-[var(--danger)]">OVERWRITE</span> to confirm:
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="w-40 rounded border border-[var(--border)] px-2 py-1 font-mono outline-none focus:border-[var(--danger)]"
                    placeholder="OVERWRITE"
                  />
                </label>
              </div>
            )}

            {preview.errors.length > 0 && <ErrTable errors={preview.errors} />}

            <div className="flex gap-2">
              <button
                onClick={() => run(false)}
                disabled={!!busy || !applyReady}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
              >
                {busy === "Applying…" ? busy : isFull ? `Apply full overwrite` : `Apply merge`}
              </button>
              <button
                onClick={() => run(true)}
                disabled={!!busy}
                className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]"
              >
                Re-validate
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 5 — done */}
      {result && (
        <section className="panel">
          <div className="panel-hd">Upload complete</div>
          <div className="p-4">
            <div
              className="mb-3 rounded-xl border px-4 py-3 text-sm font-bold"
              style={{ borderColor: "var(--accent-2)", background: "var(--accent-2-bg)", color: "var(--accent-2)" }}
            >
              ✓ {meta.label} — {result.kind === "row"
                ? `${result.inserted ?? 0} added, ${result.updated ?? 0} updated${
                    isFull ? `, ${result.deleted ?? 0} removed, ${result.protectedCount ?? 0} protected` : ""
                  }`
                : result.kind === "pair"
                  ? `${result.updated ?? 0} assignments applied`
                  : `${result.updated ?? 0} rates updated${isFull ? `, ${result.reset ?? 0} reset` : ""}`}
              {result.skipped ? `. ${result.skipped} skipped.` : "."}
            </div>
            {isFull && result.kind === "row" && (result.protectedSample?.length ?? 0) > 0 && (
              <p className="mb-2 text-xs text-[var(--muted)]">
                Protected (in use, kept): <span className="font-mono">{result.protectedSample!.join(", ")}</span>
                {(result.protectedCount ?? 0) > (result.protectedSample?.length ?? 0) && " …"}
              </p>
            )}
            {result.errors.length > 0 && <ErrTable errors={result.errors} />}
          </div>
        </section>
      )}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  tone: "safe" | "danger";
}) {
  const activeBorder = tone === "danger" ? "var(--danger)" : "var(--accent)";
  return (
    <button
      onClick={onClick}
      className="rounded-xl border-2 p-3 text-left transition"
      style={{
        borderColor: active ? activeBorder : "var(--border)",
        background: active ? "var(--surface-2)" : "var(--surface)",
      }}
    >
      <div className="text-sm font-extrabold" style={{ color: active ? activeBorder : "inherit" }}>
        {title}
      </div>
      <div className="mt-1 text-xs text-[var(--muted)]">{desc}</div>
    </button>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "accent" | "accent2" | "danger" | "muted" }) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "accent2"
        ? "var(--accent-2)"
        : tone === "accent"
          ? "var(--accent)"
          : "var(--muted)";
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2">
      <span className="text-lg font-extrabold" style={{ color }}>
        {n}
      </span>{" "}
      <span className="text-xs font-semibold text-[var(--muted)]">{label}</span>
    </div>
  );
}

function ErrTable({ errors }: { errors: Err[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
      <table className="rtable">
        <thead>
          <tr>
            <th>Row</th>
            <th>Key</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {errors.slice(0, 200).map((e, i) => (
            <tr key={i}>
              <td>{e.row || "—"}</td>
              <td className="font-mono text-xs">{e.key || "—"}</td>
              <td className="text-[var(--danger)]">{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
