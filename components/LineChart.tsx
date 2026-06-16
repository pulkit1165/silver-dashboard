import { money, shortMonth } from "@/lib/format";
import type { SalesPoint } from "@/lib/types";

export default function LineChart({ data }: { data: SalesPoint[] }) {
  const W = 720;
  const H = 240;
  const pad = { t: 16, r: 16, b: 28, l: 48 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const x = (i: number) => pad.l + (i / Math.max(data.length - 1, 1)) * iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const linePts = data.map((d, i) => `${x(i)},${y(d.revenue)}`).join(" ");
  const areaPts = `${pad.l},${pad.t + ih} ${linePts} ${x(data.length - 1)},${pad.t + ih}`;
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Revenue trend">
      <defs>
        <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridVals.map((g, i) => (
        <g key={i}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(g)}
            y2={y(g)}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
          <text x={8} y={y(g) + 4} fill="var(--muted)" fontSize="10">
            {Math.round(g / 1000)}k
          </text>
        </g>
      ))}
      <polygon points={areaPts} fill="url(#rev)" />
      <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      {data.map((d, i) => (
        <g key={d.period}>
          <circle cx={x(i)} cy={y(d.revenue)} r="3" fill="var(--accent)" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fill="var(--muted)" fontSize="10">
            {shortMonth(d.period)}
          </text>
          <title>{`${d.period}: ${money(d.revenue)} · ${d.orders} orders`}</title>
        </g>
      ))}
    </svg>
  );
}
