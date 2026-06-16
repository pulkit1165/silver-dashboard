import { money } from "@/lib/format";

export interface BarItem {
  label: string;
  value: number;
  sub?: string;
}

export default function BarList({
  items,
  valueFormatter = money,
}: {
  items: BarItem[];
  valueFormatter?: (n: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="truncate pr-3">{it.label}</span>
            <span className="text-[var(--muted)] tabular-nums">{valueFormatter(it.value)}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-[var(--surface-2)]">
            <div
              className="h-2 rounded-full bg-[var(--accent)]"
              style={{ width: `${Math.max((it.value / max) * 100, 2)}%` }}
            />
          </div>
          {it.sub && <div className="mt-0.5 text-xs text-[var(--muted)]">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
