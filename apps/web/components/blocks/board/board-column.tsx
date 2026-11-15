"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type BoardCreatePosition = "top" | "bottom";

/** Shared with board rows, whose column headers and lanes sit outside a column. */
export const BOARD_LANE_CLASS =
  "w-[92.5vw] min-w-[92.5vw] flex-none border-r border-border bg-muted/25 md:w-80 md:min-w-80 dark:bg-transparent";
export const BOARD_HEADER_CLASS =
  "flex h-10 items-center border-b border-border bg-muted/95 px-3 md:backdrop-blur md:supports-[backdrop-filter]:bg-muted/80 dark:bg-background/95 dark:md:supports-[backdrop-filter]:bg-background/80";
export const BOARD_COUNT_CLASS =
  "shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground";

export interface BoardColumnData<TItem> {
  id: string;
  title: ReactNode;
  metadata?: ReactNode;
  count?: number;
  showCount?: boolean;
  items: TItem[];
  emptyState?: ReactNode;
  /** Replaces the whole title/count cluster, e.g. a selection's bulk actions. */
  headerActions?: ReactNode;
  /** Rendered under the card stack, e.g. a "Show more" pagination control. */
  footer?: ReactNode;
  addLabel?: string;
  addInputLabel?: string;
  addPlaceholder?: string;
  canCreate?: boolean;
  createDisabledReason?: string;
  /** When set, hovering the header swaps the count badge for an edit button. */
  onEdit?: () => void;
  /** Column and header decoration, e.g. section color. */
  style?: CSSProperties;
  headerStyle?: CSSProperties;
  onCreateTask?: (title: string, position: BoardCreatePosition) => void;
}

interface BoardColumnProps<TItem> {
  column: BoardColumnData<TItem>;
  renderItem: (item: TItem, column: BoardColumnData<TItem>) => ReactNode;
  getItemKey: (item: TItem, index: number) => string;
  className?: string;
  /** Hides hover-revealed create affordances, e.g. while a drag is active. */
  hideCreateAffordances?: boolean;
  /** dnd-kit measuring ref for column reordering (label grouping). */
  containerRef?: Ref<HTMLElement>;
  /** Drag activator attributes/listeners spread onto the header when columns are reorderable. */
  headerDragHandleProps?: HTMLAttributes<HTMLElement>;
  /** `cell`: a board-row cell under shared column headers, without its own header. */
  variant?: "column" | "cell";
}

function getTitleText(title: ReactNode): string {
  return typeof title === "string" ? title : "column";
}

export function BoardColumn<TItem>({
  column,
  renderItem,
  getItemKey,
  className,
  hideCreateAffordances = false,
  containerRef,
  headerDragHandleProps,
  variant = "column",
}: BoardColumnProps<TItem>) {
  const isCell = variant === "cell";
  const [activeInput, setActiveInput] = useState<BoardCreatePosition | null>(null);
  const [topValue, setTopValue] = useState("");
  const [bottomValue, setBottomValue] = useState("");
  const topInputRef = useRef<HTMLInputElement | null>(null);
  const bottomInputRef = useRef<HTMLInputElement | null>(null);
  const count = column.count ?? column.items.length;
  const titleText = getTitleText(column.title);
  const addLabel = column.addLabel ?? `Add task to ${titleText}`;
  const addInputLabel = column.addInputLabel ?? `Task title for ${titleText}`;
  const addPlaceholder = column.addPlaceholder ?? "Add task...";
  const canCreate = column.canCreate ?? Boolean(column.onCreateTask);
  // A column that never creates (e.g. Watch Tower's derived buckets) shows no
  // button at all; a temporarily blocked one keeps it, disabled, with a reason.
  const showCreateButton = Boolean(column.onCreateTask || column.createDisabledReason);

  useEffect(() => {
    if (activeInput === "top") {
      topInputRef.current?.focus();
    } else if (activeInput === "bottom") {
      bottomInputRef.current?.focus();
    }
  }, [activeInput]);

  const commitInput = useCallback(
    (position: BoardCreatePosition, shouldRefocus: boolean) => {
      if (!canCreate) {
        return;
      }

      const value = position === "top" ? topValue : bottomValue;
      const title = value.trim();
      if (!title) {
        setActiveInput(null);
        return;
      }

      column.onCreateTask?.(title, position);
      if (position === "top") {
        setTopValue("");
        setActiveInput("top");
      } else {
        setBottomValue("");
        setActiveInput("bottom");
      }

      if (shouldRefocus) {
        // activeInput is unchanged after a commit, so the focus effect will not re-run.
        window.requestAnimationFrame(() => {
          if (position === "top") {
            topInputRef.current?.focus();
          } else {
            bottomInputRef.current?.focus();
          }
        });
      }
    },
    [bottomValue, canCreate, column, topValue]
  );

  const cancelInput = useCallback((position: BoardCreatePosition) => {
    if (position === "top") {
      setTopValue("");
      setActiveInput(null);
      return;
    }

    setBottomValue("");
    setActiveInput(null);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, position: BoardCreatePosition) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInput(position);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        commitInput(position, true);
      }
    },
    [cancelInput, commitInput]
  );

  const renderAddInput = (position: BoardCreatePosition) => {
    const isTop = position === "top";
    const value = isTop ? topValue : bottomValue;

    return (
      <div
        className={cn(
          "flex items-center gap-2 px-1 py-1",
          !isTop &&
            "opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[input:not(:placeholder-shown)]:opacity-100",
          // Cells have no header "+", and touch screens have no hover.
          !isTop && isCell && "pointer-coarse:opacity-100"
        )}
      >
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={isTop ? topInputRef : bottomInputRef}
          type="text"
          aria-label={addInputLabel}
          placeholder={addPlaceholder}
          value={value}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          onFocus={() => setActiveInput(position)}
          onChange={(event) => {
            if (isTop) {
              setTopValue(event.target.value);
            } else {
              setBottomValue(event.target.value);
            }
          }}
          onKeyDown={(event) => handleInputKeyDown(event, position)}
          onBlur={() => commitInput(position, false)}
        />
      </div>
    );
  };

  return (
    <section
      ref={containerRef}
      style={column.style}
      className={cn(
        // Mobile columns fill one gallery "slide" (92.5vw + the layout's 3.75vw
        // gutters); desktop keeps fixed-width columns.
        "group flex min-h-full flex-col",
        BOARD_LANE_CLASS,
        className
      )}
    >
      {/* backdrop-blur is desktop-only: the blurred compositing layer can
          swallow the neighboring column's hairline border on fractional
          mobile column widths. */}
      {!isCell && <header
        {...headerDragHandleProps}
        style={column.headerStyle}
        className={cn(
          // Fixed height, not padding: columns share one border line across the
          // board, so a header that grew to fit its content (a selection's
          // action buttons, an h-6 icon button) would step that line out of
          // alignment in one column only. h-10 is what `py-2` already produced.
          "group/header sticky top-0 z-10 justify-between",
          BOARD_HEADER_CLASS,
          headerDragHandleProps && "cursor-grab touch-none active:cursor-grabbing"
        )}
      >
        {column.headerActions ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {column.headerActions}
          </div>
        ) : (
        <div className="min-w-0 flex items-center gap-2">
          {column.metadata ? (
            <span className="flex shrink-0 items-center gap-2">
              {column.metadata}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-foreground">
            {column.title}
          </span>
          {column.showCount ? (
            <span
              className={cn(
                BOARD_COUNT_CLASS,
                column.onEdit &&
                  "group-hover/header:hidden group-focus-within/header:hidden"
              )}
            >
              {count}
            </span>
          ) : null}
          {column.onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Edit ${titleText}`}
              className="hidden size-6 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground group-hover/header:inline-flex group-focus-within/header:inline-flex"
              // The header doubles as the column drag handle.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={column.onEdit}
            >
              <Pencil className="size-3" />
            </Button>
          ) : null}
        </div>
        )}
        {showCreateButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={addLabel}
            title={canCreate ? undefined : column.createDisabledReason}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            disabled={!canCreate}
            onClick={() => {
              if (canCreate) {
                setActiveInput("top");
              }
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </header>}

      <div className={cn("flex-1 p-3", isCell ? "min-h-20" : "pb-24")}>
        <div className="flex flex-col gap-3">
          {canCreate && activeInput === "top" ? renderAddInput("top") : null}
          {column.items.length > 0
            ? column.items.map((item, index) => (
                <Fragment key={getItemKey(item, index)}>
                  {renderItem(item, column)}
                </Fragment>
              ))
            : column.emptyState && !activeInput ? (
                <div
                  className={cn(
                    "px-1 py-1 text-sm text-muted-foreground",
                    canCreate &&
                      !hideCreateAffordances &&
                      cn("group-hover:hidden group-focus-within:hidden", isCell && "pointer-coarse:hidden")
                  )}
                >
                  {column.emptyState}
                </div>
              ) : null}
          {canCreate && activeInput !== "top" && !hideCreateAffordances
            ? renderAddInput("bottom")
            : null}
        </div>
        {column.footer ? <div className="pt-1">{column.footer}</div> : null}
      </div>
    </section>
  );
}
