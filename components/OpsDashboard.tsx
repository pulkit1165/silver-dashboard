"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OpsSummary, PeriodFigures } from "@/lib/types";
import { num2 } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  return {
    date: `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    day: DAYS[d.getDay()],
  };
}

export default function OpsDashboard({ data }: { data: OpsSummary }) {
  const router = useRouter();
  const [tab, setTab] = useState<"sale" | "stock">("sale");
  const { date, day } = fmtDate(data.asOf);

  const recvTotal = data.receivables.reduce(
    (a, r) => ({
      lt60: a.lt60 + r.lt60,
      d60_90: a.d60_90 + r.d60_90,
      d90_120: a.d90_120 + r.d90_120,
      gt120: a.gt120 + r.gt120,
    }),
    { lt60: 0, d60_90: 0, d90_120: 0, gt120: 0 },
  );
  const recvSum = recvTotal.lt60 + recvTotal.d60_90 + recvTotal.d90_120 + recvTotal.gt120;

  return (
    <div className="flex flex-col gap-5">
      {/* Top bar: date / day / refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_1px_2px_rgba(11,11,11,0.03)]">
        <div className="flex flex-wrap items-center gap-6">
          <Stamp label="Date" value={date} />
          <span className="hidden h-8 w-px bg-[var(--border)] sm:block" />
          <Stamp label="Day" value={day} />
        </div>
        <button
          onClick={() => router.refresh()}
          className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-bg)]"
        >
          ⟳ Refresh
        </button>
      </div>

      {data.note && (
        <div className="-mt-2 inline-flex w-fit items-center gap-2 rounded-lg border border-[#f0c98a] bg-[var(--warning-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)]">
          <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
          {data.note}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Sale · Today" value={String(data.sale.today)} sub={`MTD ${data.sale.mtd}`} />
        <Kpi
          label="Purchase · Today"
          value={String(data.purchase.today)}
          sub={`MTD ${data.purchase.mtd}`}
        />
        <Kpi label="Receivables" value={num2(recvSum)} sub={`> 120 days: ${num2(recvTotal.gt120)}`} />
        <Kpi
          label="Bank Balance"
          value={num2(data.bankTotal)}
          sub={`${data.banks.length} accounts`}
          negative={data.bankTotal < 0}
        />
        <Kpi
          label="Net DR / CR"
          value={num2(data.drcr.total)}
          sub={`DR ${num2(data.drcr.dr)} · CR ${num2(data.drcr.cr)}`}
        />
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1">
        <Tab active={tab === "sale"} onClick={() => setTab("sale")}>
          Sale / Purchase
        </Tab>
        <Tab active={tab === "stock"} onClick={() => setTab("stock")}>
          Stock
        </Tab>
      </div>

      {tab === "stock" ? (
        <section className="panel">
          <div className="panel-hd">Stock</div>
          <div className="p-6 text-sm text-[var(--muted)]">
            Stock detail lives on the{" "}
            <a href="/inventory" className="font-bold text-[var(--accent)] underline">
              Inventory
            </a>{" "}
            page. The live Stock tab will mirror the client&apos;s second screen once the queries are
            mapped.
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* LEFT */}
          <div className="flex flex-col gap-5">
            <section className="panel">
              <div className="panel-hd">Sale</div>
              <PeriodTable figures={data.sale} unit="orders" />
              <div className="divide-y divide-[var(--border-2)] border-t border-[var(--border)] text-sm">
                <Row label="Order In Hand" value={String(data.orderInHand)} />
                <Row
                  label="Order Dispatch Ratio (Item Wise %)"
                  value={data.orderDispatchRatio == null ? "—" : `${num2(data.orderDispatchRatio)}%`}
                  muted
                />
              </div>
              <div className="flex justify-end border-t border-[var(--border)] p-3">
                <button className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">
                  Agent Wise Sale →
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="panel-hd">Purchase</div>
              <PeriodTable figures={data.purchase} unit="orders" />
            </section>

            <section className="panel">
              <div className="panel-hd">Receivable</div>
              <div className="overflow-x-auto">
                <table className="rtable">
                  <thead>
                    <tr>
                      <th>Firm</th>
                      <th className="!text-right">&lt; 60</th>
                      <th className="!text-right">60–90</th>
                      <th className="!text-right">90–120</th>
                      <th className="!text-right">&gt; 120</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.receivables.map((r) => (
                      <tr key={r.firm}>
                        <td className="font-bold">{r.firm}</td>
                        <Money v={r.lt60} />
                        <Money v={r.d60_90} />
                        <Money v={r.d90_120} />
                        <Money v={r.gt120} />
                      </tr>
                    ))}
                    <tr className="bg-[var(--accent-bg)]">
                      <td className="font-extrabold uppercase tracking-wide text-[var(--accent-strong)]">
                        Total
                      </td>
                      <Money v={recvTotal.lt60} strong />
                      <Money v={recvTotal.d60_90} strong />
                      <Money v={recvTotal.d90_120} strong />
                      <Money v={recvTotal.gt120} strong />
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-5">
            <section className="panel">
              <div className="panel-hd">Bank Balance</div>
              <BankTable data={data} />
            </section>

            <section className="panel">
              <div className="panel-hd">Total DR / CR</div>
              <table className="rtable">
                <tbody>
                  <tr>
                    <td className="font-bold">DR</td>
                    <Money v={data.drcr.dr} />
                  </tr>
                  <tr>
                    <td className="font-bold">CR</td>
                    <Money v={data.drcr.cr} />
                  </tr>
                  <tr className="bg-[var(--accent-bg)]">
                    <td className="font-extrabold uppercase tracking-wide text-[var(--accent-strong)]">
                      Total
                    </td>
                    <Money v={data.drcr.total} strong />
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── building blocks ─────────────────────────────────────────────────── */

function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </div>
      <div className="text-[15px] font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  negative?: boolean;
}) {
  return (
    <div className={`kpi ${negative ? "alert" : ""}`}>
      <div className="lab">{label}</div>
      <div className="num" style={negative ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Tab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-5 py-1.5 text-sm font-bold transition-colors ${
        active
          ? "bg-[var(--accent)] text-white shadow-sm"
          : "text-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function PeriodTable({ figures, unit }: { figures: PeriodFigures; unit?: string }) {
  const cells: Array<[string, number, boolean]> = [
    ["Today", figures.today, false],
    ["MTD", figures.mtd, false],
    ["PMTD", figures.pmtd, false],
    ["YTD", figures.ytd, false],
    ["PYTD", figures.pytd, false],
    ["SRT/EXC", figures.srtExc, true],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="rtable">
        <thead>
          <tr>
            {cells.map(([h]) => (
              <th key={h} className="!text-center">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="hover:!bg-transparent">
            {cells.map(([h, v, isSrt]) => {
              const neg = v < 0;
              return (
                <td key={h} className="!text-center">
                  {isSrt ? (
                    <span
                      className="tag"
                      style={{
                        background: neg ? "var(--danger-bg)" : "var(--accent-2-bg)",
                        color: neg ? "var(--danger)" : "var(--accent-2)",
                      }}
                    >
                      {v > 0 ? `+${v}` : v}
                    </span>
                  ) : (
                    <span className="text-[17px] font-extrabold tracking-tight">{v}</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {unit && (
        <div className="px-3 pb-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-2)]">
          figures in {unit}
        </div>
      )}
    </div>
  );
}

function BankTable({ data }: { data: OpsSummary }) {
  const groups: Array<{ group: string; rows: typeof data.banks }> = [];
  for (const b of data.banks) {
    const last = groups[groups.length - 1];
    if (last && last.group === b.group) last.rows.push(b);
    else groups.push({ group: b.group, rows: [b] });
  }
  return (
    <table className="rtable">
      <thead>
        <tr>
          <th colSpan={2}>Bank Name</th>
          <th className="!text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) =>
          g.rows.map((b, i) => (
            <tr key={`${g.group}-${b.bank}`}>
              {i === 0 && (
                <td
                  rowSpan={g.rows.length}
                  className="border-r border-[var(--border-2)] font-extrabold text-[var(--ink-2)]"
                >
                  {g.group}
                </td>
              )}
              <td className="font-semibold">{b.bank}</td>
              <Money v={b.balance} />
            </tr>
          )),
        )}
        <tr className="bg-[var(--accent-bg)]">
          <td colSpan={2} className="font-extrabold uppercase tracking-wide text-[var(--accent-strong)]">
            Total
          </td>
          <Money v={data.bankTotal} strong />
        </tr>
      </tbody>
    </table>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="font-semibold">{label}</span>
      <span
        className={`font-extrabold tabular-nums ${muted ? "text-[var(--muted-2)]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function Money({ v, strong }: { v: number; strong?: boolean }) {
  const neg = v < 0;
  return (
    <td className={`num-cell ${neg ? "neg" : ""} ${strong ? "font-extrabold" : "font-semibold"}`}>
      {num2(v)}
    </td>
  );
}
