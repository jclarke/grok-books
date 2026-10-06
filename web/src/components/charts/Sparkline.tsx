import { linear } from "./scale";

export function Sparkline({ values, tone = "net", label, width = 84, height = 28 }: { values: number[]; tone?: string; label: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linear([0, values.length - 1], [2, width - 2]);
  const y = linear([min, max === min ? min + 1 : max], [height - 3, 3]);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg className={`sparkline tone-${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={points} fill="none" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.6} />
    </svg>
  );
}
