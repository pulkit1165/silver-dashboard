"use client";

// Visual label-size picker: each stock shows as a little mock-up of the real label
// (colour + shape + a sketch of the QR & text) with a heading and its mm size, so the
// shop team picks by sight instead of reading a dropdown.

type SizeMeta = { id: string; heading: string; w: number; h: number; color: string; ink: string; twoUp?: boolean };
export const SIZE_META: SizeMeta[] = [
  { id: "big-95x70", heading: "Big Green", w: 95, h: 70, color: "#8cc63f", ink: "#141414" },
  { id: "red-85x55", heading: "Red", w: 85, h: 55, color: "#e11d2a", ink: "#ffffff" },
  { id: "med-70x40", heading: "Medium Green", w: 70, h: 40, color: "#8cc63f", ink: "#141414" },
  { id: "green-65x35", heading: "Green", w: 65, h: 35, color: "#8cc63f", ink: "#141414" },
  { id: "small-50x30", heading: "Small Green", w: 50, h: 30, color: "#8cc63f", ink: "#141414", twoUp: true },
  { id: "custom", heading: "Custom", w: 70, h: 40, color: "#eaeaea", ink: "#555" },
];

function MiniLabel({ m, H = 52 }: { m: SizeMeta; H?: number }) {
  const W = Math.round(H * (m.w / m.h));
  const cell = (extraW = 1) => (
    <div className="relative flex items-center gap-[3px] rounded-[3px] px-[4px]" style={{ background: m.color, width: (W - 4) * extraW, height: H }}>
      {/* QR block */}
      <div className="shrink-0 rounded-[1px]" style={{ width: H * 0.34, height: H * 0.34, background: `repeating-conic-gradient(${m.ink} 0% 25%, transparent 0% 50%) 0 0 / 4px 4px`, outline: `1px solid ${m.ink}` }} />
      {/* text lines */}
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        {[0.9, 0.7, 0.5].map((wf, i) => <div key={i} style={{ height: 2, width: `${wf * 100}%`, background: m.ink, opacity: 0.85 }} />)}
      </div>
    </div>
  );
  return (
    <div className="flex items-center gap-[3px]" style={{ height: H }}>
      {cell()}
      {m.twoUp && cell()}
    </div>
  );
}

export default function LabelSizePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="no-print">
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Pick the label size</div>
      <div className="flex flex-wrap gap-2">
        {SIZE_META.map((m) => {
          const on = value === m.id;
          return (
            <button key={m.id} onClick={() => onChange(m.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition ${on ? "border-[var(--accent)] bg-[var(--accent-bg)] shadow" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50"}`}
              style={{ minWidth: 96 }}>
              <div className="grid h-[54px] place-items-center">
                {m.id === "custom"
                  ? <div className="grid h-[52px] w-[72px] place-items-center rounded-[3px] border-2 border-dashed border-[var(--muted-2)] text-lg text-[var(--muted)]">＋</div>
                  : <MiniLabel m={m} />}
              </div>
              <div className="text-center leading-tight">
                <div className="text-xs font-extrabold">{m.heading}</div>
                <div className="text-[10px] font-semibold text-[var(--muted)]">{m.id === "custom" ? "any size" : `${m.w} × ${m.h} mm${m.twoUp ? " · 2-up" : ""}`}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
