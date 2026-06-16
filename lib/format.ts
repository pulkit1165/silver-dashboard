export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: process.env.NEXT_PUBLIC_CURRENCY || "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function count(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

// Two-decimal amount with thousands separators (e.g. 136.64, -149.73).
export function num2(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function percent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatKpi(value: number, unit?: string): string {
  if (unit === "currency") return money(value);
  if (unit === "percent") return percent(value);
  return count(value);
}

export function shortMonth(period: string): string {
  // "2026-01" -> "Jan"
  const [, m] = period.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(m) - 1] ?? period;
}
