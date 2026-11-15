import { cn } from "@/lib/utils";

/** Tiny trend line with an emphasized endpoint, for stat tiles. */
export function Sparkline({
  data,
  className,
  color = "var(--chart-1)",
}: {
  data: number[];
  className?: string;
  color?: string;
}) {
  if (data.length < 2) {
    return null;
  }
  const W = 160;
  const H = 28;
  const max = Math.max(...data, Number.EPSILON);
  const step = W / (data.length - 1);
  const yOf = (v: number) => H - 2 - (v / max) * (H - 6);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(" ");
  const lastX = ((data.length - 1) * step).toFixed(1);
  const lastY = yOf(data[data.length - 1]).toFixed(1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("block h-7 w-full", className)}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}
