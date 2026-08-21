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

// MRP as printed on labels: KEEP the decimals (they're crucial) but show a clean whole
// number when the amount is whole. Rounds to 2dp to clear float noise
// (5.1000000000000005 → "5.10", 436.65000000000003 → "436.65"), drops trailing ".00"
// (175 → "175", 175.5 → "175.50", 1.85 → "1.85").
export function mrp(n: number): string {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
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

// "22-Jun-2026" — the PKD (packed date) format on printed labels.
export function pkd(date = new Date()): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getDate()).padStart(2, "0")}-${names[date.getMonth()]}-${date.getFullYear()}`;
}
