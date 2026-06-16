"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/Card";
import type { TableInfo, ColumnInfo, QueryResult } from "@/lib/types";

export default function ExplorerPage() {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [schemaErr, setSchemaErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null);
  const [sql, setSql] = useState("SELECT 1 AS hello FROM dual");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/schema")
      .then((r) => r.json())
      .then((d) => (d.error ? setSchemaErr(d.error) : setTables(d.tables)))
      .catch((e) => setSchemaErr(String(e)));
  }, []);

  async function openTable(t: string) {
    setActive(t);
    setColumns(null);
    setSql(`SELECT * FROM ${t} FETCH FIRST 100 ROWS ONLY`);
    const d = await fetch(`/api/schema/${encodeURIComponent(t)}`).then((r) => r.json());
    if (!d.error) setColumns(d.columns);
  }

  async function run() {
    setRunning(true);
    setQueryErr(null);
    setResult(null);
    try {
      const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const d = await r.json();
      if (d.error) setQueryErr(d.error);
      else setResult(d);
    } catch (e) {
      setQueryErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  const shown = (tables ?? []).filter((t) =>
    t.table.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Data Explorer"
        subtitle="Browse the live schema and run read-only SELECT queries. Writes are blocked."
      />

      {schemaErr && (
        <div className="mb-6 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          Schema unavailable: <span className="text-[var(--muted)]">{schemaErr}</span>
          <div className="mt-1 text-xs text-[var(--muted)]">
            This works once the live Oracle connection is configured (see the Connection page).
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <Card title={`Tables${tables ? ` (${tables.length})` : ""}`}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables…"
            className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {!tables && !schemaErr && <div className="text-sm text-[var(--muted)]">Loading…</div>}
            {shown.map((t) => (
              <button
                key={`${t.owner}.${t.table}`}
                onClick={() => openTable(t.table)}
                className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                  active === t.table
                    ? "bg-[var(--accent)]/15"
                    : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="truncate font-mono text-xs">{t.table}</span>
                {t.rows != null && (
                  <span className="ml-2 shrink-0 text-[10px] text-[var(--muted)]">
                    {t.rows.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {columns && (
            <Card title={`Columns — ${active}`}>
              <div className="flex flex-wrap gap-2">
                {columns.map((c) => (
                  <span
                    key={c.name}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs"
                    title={`${c.type}${c.nullable ? " · nullable" : ""}`}
                  >
                    <span className="font-mono">{c.name}</span>{" "}
                    <span className="text-[var(--muted)]">{c.type}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          <Card
            title="Query"
            right={
              <button
                onClick={run}
                disabled={running}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {running ? "Running…" : "Run (read-only)"}
              </button>
            }
          >
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              rows={4}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-sm outline-none focus:border-[var(--accent)]"
            />
            {queryErr && (
              <div className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {queryErr}
              </div>
            )}
            {result && <ResultTable result={result} />}
          </Card>
        </div>
      </div>
    </>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs text-[var(--muted)]">
        {result.rowCount} row(s) · {result.elapsedMs} ms
        {result.truncated && " · truncated"}
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--surface-2)]">
            <tr className="text-left">
              {result.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                {result.columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                    {format(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
