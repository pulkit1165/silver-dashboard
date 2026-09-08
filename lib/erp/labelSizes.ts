// The physical label stocks Silver uses (width × height in mm). Shared by the
// label print screen and the printer manager so sizes stay in one place.
export type LabelSize = { id: string; label: string; w: number; h: number };

export const LABEL_SIZES: LabelSize[] = [
  { id: "big-95x70", label: "Big green · 95 × 70 mm", w: 95, h: 70 },
  { id: "red-85x55", label: "Red · 85 × 55 mm", w: 85, h: 55 },
  { id: "green-65x35", label: "Green · 65 × 35 mm", w: 65, h: 35 },
  { id: "med-70x40", label: "Medium green · 70 × 40 mm", w: 70, h: 40 },
  { id: "small-50x30", label: "Small green · 50 × 30 mm", w: 50, h: 30 },
];

// ── Long-name variant ────────────────────────────────────────────────────────
// A "big name" SKU can print a DIFFERENT design at the same physical size. That
// design is stored under a sibling id `<sizeId>__long` (same w×h). Operators never
// pick it — the print page auto-selects it per SKU. The Designer lists both so the
// long-name layout can be created/approved separately.
export const LONG_SUFFIX = "__long";
export const longSizeId = (id: string): string => (id.endsWith(LONG_SUFFIX) ? id : id + LONG_SUFFIX);
export const isLongSizeId = (id: string): boolean => id.endsWith(LONG_SUFFIX);
export const baseSizeId = (id: string): string => (id.endsWith(LONG_SUFFIX) ? id.slice(0, -LONG_SUFFIX.length) : id);

// The Designer's size list = every physical size plus its LONG-names sibling.
export const DESIGNER_SIZES: LabelSize[] = LABEL_SIZES.flatMap((s) => [
  s,
  { id: longSizeId(s.id), label: `${s.label}  ·  LONG names`, w: s.w, h: s.h },
]);

// Resolve dims for any id (long variants share the base size's w×h).
export const labelSizeById = (id?: string | null): LabelSize | undefined =>
  LABEL_SIZES.find((s) => s.id === (id ? baseSizeId(id) : id));
export const sizeLabel = (id?: string | null): string => labelSizeById(id)?.label ?? (id || "—");
