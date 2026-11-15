import type { ReactNode } from "react";

/**
 * Shared lightweight SVG chart primitives. Data-in/presentation-out props so
 * the internals can later be swapped for a chart library without touching
 * call sites. Series colors are CSS color strings — pass the theme's
 * categorical slots (`var(--chart-1)`…`var(--chart-5)`) in fixed series
 * order; never cycle or reorder slots when the series set changes.
 */
export type ChartSeries = {
  key: string;
  label: string;
  /** CSS color, e.g. `var(--chart-1)`. */
  color: string;
};

export type StackedBarDatum = {
  /** X position (e.g. a UTC day-start timestamp). */
  x: number;
  /** Value per series key; missing keys count as 0. */
  values: Record<string, number>;
  valueLabels?: Record<string, string>;
  totalLabel?: string;
  description?: string;
};

export type ShareBarRow = {
  key: string;
  label: ReactNode;
  /** Secondary line under/next to the label (e.g. "1.8M tokens · 42%"). */
  detail?: string;
  /** Right-aligned value text. */
  valueText: ReactNode;
  /** Bar length driver; bars scale relative to the largest row. */
  value: number;
  /** CSS color; defaults to the first categorical slot. */
  color?: string;
};

export type CompositionSegment = {
  key: string;
  label: string;
  value: number;
  /** CSS color, e.g. `var(--chart-1)`. */
  color: string;
  /** Right-aligned value text in the legend row. */
  valueText: ReactNode;
};
