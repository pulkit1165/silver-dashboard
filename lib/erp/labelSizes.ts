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

export const labelSizeById = (id?: string | null): LabelSize | undefined => LABEL_SIZES.find((s) => s.id === id);
export const sizeLabel = (id?: string | null): string => labelSizeById(id)?.label ?? (id || "—");
