"use client";

import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BoardLayoutColumn {
  id: string;
}

interface BoardLayoutProps<TColumn extends BoardLayoutColumn> {
  columns: TColumn[];
  renderColumn: (column: TColumn) => ReactNode;
  className?: string;
  trackClassName?: string;
  trackStyle?: CSSProperties;
  /** Rendered in the track after the last column (e.g. an "add column" affordance). */
  trailing?: ReactNode;
  /**
   * Share the viewport evenly between columns instead of using fixed-width ones
   * (OS-1595). Columns never shrink past `md:min-w-80`, so a board with too many
   * to fit falls back to horizontal scrolling. For a small, fixed set of columns
   * — not a board whose column count follows the data, where equal shares get
   * absurdly wide at two columns.
   */
  fillWidth?: boolean;
}

export function BoardLayout<TColumn extends BoardLayoutColumn>({
  columns,
  renderColumn,
  className,
  trackClassName,
  trackStyle,
  trailing,
  fillWidth = false,
}: BoardLayoutProps<TColumn>) {
  return (
    <div
      className={cn(
        // On mobile the board behaves like a gallery: native scroll snapping
        // shows one column per view with the neighbors peeking at the edges.
        "h-full w-full overflow-auto snap-x snap-mandatory md:snap-none",
        className
      )}
    >
      <div
        className={cn(
          // The mobile gutters center a snapped column and leave the empty
          // space before the first column / after the last one.
          "flex min-h-full min-w-max px-[3.75vw] md:px-0",
          // Desktop only: mobile keeps its one-column-per-view snap gallery.
          // `md:min-w-0` must beat `min-w-max`, which would size the track to
          // its content (every column's widest card summed) and blow past the
          // viewport. The columns' own `md:min-w-80` is the real floor: once the
          // shares hit it the track overflows and the board scrolls.
          fillWidth && "md:w-full md:min-w-0",
          trackClassName
        )}
        style={trackStyle}
      >
        {columns.map((column) => (
          <div
            key={column.id}
            // Columns draw right borders only; on mobile the first column's
            // left edge floats in the gutter, so it gets its own border here.
            className={cn(
              "flex snap-center max-md:first:border-l max-md:first:border-border md:snap-align-none",
              // `basis-0 grow` splits the track evenly, and the explicit
              // `md:min-w-80` gives every column the SAME floor. Without it a
              // flex item's `min-width: auto` floors it at its own content, so
              // the column holding the longest card title would stay wider than
              // its neighbours — equal shares, unequal floors.
              fillWidth && "md:min-w-80 md:grow md:basis-0"
            )}
          >
            {renderColumn(column)}
          </div>
        ))}
        {trailing}
      </div>
    </div>
  );
}
