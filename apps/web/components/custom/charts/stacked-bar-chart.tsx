"use client";

import { useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { ChartSeries, StackedBarDatum } from "./types";

const VIEW_W = 720;
const VIEW_H = 240;
const PAD_LEFT = 44;
const PAD_RIGHT = 6;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const Y_TICKS = 4;
const X_TICKS = 5;

type TooltipState = {
  index: number;
  left: number;
  top: number;
};

/**
 * Vertical bars stacked by series over an ordered x-axis, with a legend and
 * a per-bar hover tooltip breaking the stack down.
 */
export function StackedBarChart({
  series,
  data,
  formatX,
  formatValue,
  formatAxisValue = formatValue,
  ariaLabel,
  className,
}: {
  series: ChartSeries[];
  data: StackedBarDatum[];
  formatX: (x: number) => string;
  formatValue: (value: number) => string;
  formatAxisValue?: (value: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const totals = data.map((d) =>
    series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0)
  );
  const max = Math.max(...totals, Number.EPSILON) * 1.08;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const slotW = plotW / Math.max(data.length, 1);
  const barW = Math.max(slotW - 2, 1.5);
  const xTickEvery = Math.max(Math.ceil(data.length / X_TICKS), 1);

  const handleMove = (event: MouseEvent, index: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setTooltip({
      index,
      left: Math.min(event.clientX - box.left + 14, box.width - 232),
      top: Math.max(event.clientY - box.top - 40, 0),
    });
  };

  const hovered = tooltip ? data[tooltip.index] : null;

  return (
    <div className={className}>
      <div className="mb-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[3px]"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={boxRef} className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={ariaLabel}
          className="block h-60 w-full"
          onMouseLeave={() => setTooltip(null)}
        >
          {Array.from({ length: Y_TICKS + 1 }, (_, i) => {
            const value = (max / Y_TICKS) * i;
            const y = PAD_TOP + plotH - (value / max) * plotH;
            return (
              <g key={i}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={VIEW_W - PAD_RIGHT}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray={i === 0 ? undefined : "2 4"}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--muted-foreground)"
                >
                  {formatAxisValue(value)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) =>
            i % xTickEvery === 0 ? (
              <text
                key={d.x}
                x={PAD_LEFT + i * slotW + barW / 2}
                y={VIEW_H - 5}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted-foreground)"
              >
                {formatX(d.x)}
              </text>
            ) : null
          )}
          {data.map((d, i) => {
            let y = PAD_TOP + plotH;
            const segments = series
              .map((s) => ({ s, value: d.values[s.key] ?? 0 }))
              .filter(({ value }) => (value / max) * plotH >= 0.5);
            return (
              <g
                key={d.x}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${formatX(d.x)}: ${d.totalLabel ?? formatValue(totals[i])}. ${d.description ?? ""}`}
                onFocus={() => setTooltip({ index: i, left: 0, top: 0 })}
                onBlur={() => setTooltip(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTooltip(null);
                }}
                onMouseMove={(event) => handleMove(event, i)}
                onMouseLeave={() => setTooltip(null)}
              >
                {segments.map(({ s, value }, si) => {
                  const height = (value / max) * plotH;
                  y -= height;
                  const isTop = si === segments.length - 1;
                  return (
                    <rect
                      key={s.key}
                      x={PAD_LEFT + i * slotW}
                      y={y + (isTop ? 0 : 1)}
                      width={barW}
                      height={Math.max(height - 1, 0.75)}
                      rx={isTop ? 2 : 0}
                      fill={s.color}
                    />
                  );
                })}
                <rect
                  x={PAD_LEFT + i * slotW - 1}
                  y={PAD_TOP}
                  width={slotW + 1}
                  height={plotH}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
        {hovered ? (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: tooltip?.left, top: tooltip?.top }}
          >
            <div className="mb-1 text-muted-foreground">
              {formatX(hovered.x)}
            </div>
            {series.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-3 tabular-nums"
              >
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}
                </span>
                <span className="text-right">
                  {hovered.valueLabels?.[s.key] ??
                    formatValue(hovered.values[s.key] ?? 0)}
                </span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between gap-3 border-t pt-1 font-medium tabular-nums">
              <span>Total</span>
              <span className="text-right">
                {hovered.totalLabel ??
                  formatValue(totals[tooltip?.index ?? 0] ?? 0)}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
