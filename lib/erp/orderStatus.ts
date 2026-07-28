// Derived, human sales-order status — the single source of truth for the pill
// shown on the Orders list and the order detail page. Pure (no server imports)
// so both server pages and client components can use it.
//
// The raw sales_orders.status is the lifecycle state (decoded/draft/confirmed/
// picked/packed/partially dispatched/dispatched/cancelled). We fold that plus
// the packed/dispatched quantities into the five business statuses the team uses:
//   Not punched · Punched · Packed · Partial packed · Dispatched
// (+ Partial dispatched / Draft / Cancelled for completeness).

export type StatusTone = "accent" | "info" | "good" | "danger" | "neutral";
export interface OrderStatus { key: string; label: string; tone: StatusTone }

export interface OrderQty { status: string; ordered_qty?: number; packed_qty?: number; dispatched_qty?: number }

export function orderDisplayStatus(o: OrderQty): OrderStatus {
  const s = String(o.status || "").toLowerCase();
  if (s === "cancelled") return { key: "cancelled", label: "Cancelled", tone: "danger" };
  if (s === "decoded") return { key: "not-punched", label: "Not punched", tone: "neutral" };
  if (s === "draft") return { key: "draft", label: "Draft", tone: "neutral" };

  const ord = Number(o.ordered_qty) || 0;
  const pk = Number(o.packed_qty) || 0;
  const dp = Number(o.dispatched_qty) || 0;

  if (dp > 0 && ord > 0 && dp >= ord) return { key: "dispatched", label: "Dispatched", tone: "good" };
  if (dp > 0) return { key: "partial-dispatched", label: "Partial dispatched", tone: "info" };
  if (pk > 0 && ord > 0 && pk >= ord) return { key: "packed", label: "Packed", tone: "info" };
  if (pk > 0) return { key: "partial-packed", label: "Partial packed", tone: "info" };
  return { key: "punched", label: "Punched", tone: "accent" };
}

// Options for the status filter dropdown (value = OrderStatus.key).
export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "not-punched", label: "Not punched" },
  { value: "punched", label: "Punched" },
  { value: "packed", label: "Packed" },
  { value: "partial-packed", label: "Partial packed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "partial-dispatched", label: "Partial dispatched" },
  { value: "delivered", label: "Delivered (legacy)" },
  { value: "draft", label: "Draft" },
  { value: "cancelled", label: "Cancelled" },
];

// status_key → label + tone (covers ERP-derived keys + legacy 'delivered').
export const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  "not-punched": { label: "Not punched", tone: "neutral" },
  punched: { label: "Punched", tone: "accent" },
  packed: { label: "Packed", tone: "info" },
  "partial-packed": { label: "Partial packed", tone: "info" },
  dispatched: { label: "Dispatched", tone: "good" },
  "partial-dispatched": { label: "Partial dispatched", tone: "info" },
  delivered: { label: "Delivered", tone: "good" },
  draft: { label: "Draft", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

// Tone → light pill colors (inline so it works anywhere without CSS classes).
export const TONE_STYLE: Record<StatusTone, { bg: string; fg: string; dot: string }> = {
  accent: { bg: "#eef2ff", fg: "#4338ca", dot: "#6366f1" },
  info: { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
  good: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
  danger: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
  neutral: { bg: "#f4f4f5", fg: "#52525b", dot: "#a1a1aa" },
};
