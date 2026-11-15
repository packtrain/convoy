"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOARD_COUNT_CLASS, BOARD_HEADER_CLASS, BOARD_LANE_CLASS } from "./board-column";

export interface BoardSwimlaneGroup {
  id: string;
  title: string;
  metadata?: ReactNode;
  count: number;
}

// The first cell's wrapper draws its left line outside the 92.5vw column, as
// BoardLayout does, so the other first lanes take that extra pixel too.
const FIRST_LANE_CLASS = "max-md:first:border-l max-md:first:w-[calc(92.5vw+1px)]";

/** Board rows: shared column headers on top, then one collapsible lane of cells per row. */
export function BoardSwimlanes<TGroup extends BoardSwimlaneGroup>({
  rows,
  columns,
  collapsedRowIds,
  onToggleRow,
  renderCell,
  className,
  trackStyle,
}: {
  rows: readonly TGroup[];
  columns: readonly TGroup[];
  collapsedRowIds: ReadonlySet<string>;
  onToggleRow: (rowId: string) => void;
  renderCell: (row: TGroup, column: TGroup) => ReactNode;
  className?: string;
  trackStyle?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        // Mobile keeps the one-column-per-view gallery; the header cells are the snap points.
        "h-full w-full overflow-auto snap-x snap-mandatory md:snap-none",
        className
      )}
    >
      <div className="flex min-h-full min-w-max flex-col" style={trackStyle}>
        <div className="sticky top-0 z-20 flex px-[3.75vw] md:px-0">
          {columns.map((column) => (
            <div
              key={column.id}
              className={cn(BOARD_HEADER_CLASS, "w-[92.5vw] flex-none snap-center gap-2 border-r md:w-80 md:snap-align-none", FIRST_LANE_CLASS)}
            >
              {column.metadata ? (
                <span className="flex shrink-0 items-center gap-2">{column.metadata}</span>
              ) : null}
              <span className="truncate text-sm font-medium text-foreground">{column.title}</span>
              <span className={BOARD_COUNT_CLASS}>{column.count}</span>
            </div>
          ))}
        </div>
        {rows.map((row) => {
          const collapsed = collapsedRowIds.has(row.id);
          return (
            <section key={row.id} aria-label={row.title}>
              <div className="relative border-b border-border bg-muted/40">
                {/* Mobile: the column lines run through the row header too. */}
                <div data-slot="board-column-lines" aria-hidden className="pointer-events-none absolute inset-0 flex px-[3.75vw] md:hidden">
                  {columns.map((column) => (
                    <div key={column.id} className={cn("w-[92.5vw] flex-none border-r border-border", FIRST_LANE_CLASS)} />
                  ))}
                </div>
                {/* Sticky so the row label stays in view while scrolling columns. */}
                <div className="sticky left-0 flex h-10 w-fit max-w-[100vw] items-center gap-2 px-3 max-md:pl-[calc(3.75vw+0.75rem)]">
                  <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${row.title}`}
                    aria-expanded={!collapsed}
                    onClick={() => onToggleRow(row.id)}
                  >
                    <ChevronRight
                      className={cn(
                        "pointer-events-none h-4 w-4 text-muted-foreground transition-transform duration-150",
                        !collapsed && "rotate-90"
                      )}
                    />
                  </button>
                  {row.metadata}
                  <span className="truncate text-sm font-medium">{row.title}</span>
                  <span className={BOARD_COUNT_CLASS}>{row.count}</span>
                </div>
              </div>
              {collapsed ? null : (
                // A line separates an expanded lane from the next row header.
                <div className="flex border-b border-border px-[3.75vw] md:px-0">
                  {columns.map((column) => (
                    <div key={column.id} className="flex max-md:first:border-l max-md:first:border-border">
                      {renderCell(row, column)}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {/* Carries the column lines to the board bottom. */}
        <div data-slot="board-lane-filler" aria-hidden className="flex flex-1 px-[3.75vw] md:px-0">
          {columns.map((column) => (
            <div key={column.id} className={cn(BOARD_LANE_CLASS, FIRST_LANE_CLASS)} />
          ))}
        </div>
      </div>
    </div>
  );
}
