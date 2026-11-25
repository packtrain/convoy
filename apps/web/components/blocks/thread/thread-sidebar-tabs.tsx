"use client";

import { Fragment, useState, type ReactElement, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  PanelRightClose,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type {
  CliRunDiffFile,
  CliRunDiffSummary,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";
import type { ThreadPullRequest } from "@/lib/threads/pull-request";
import type { TimelineRun } from "@/lib/threads/run-timeline";
import { cn } from "@/lib/utils";
import { RunTimelinePanel } from "./run-timeline-panel";
import { ThreadPrBadge } from "./thread-pr-badge";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";

/**
 * Panels the sidebar can render; `task` only while a task is selected,
 * `artifact` only while `threadArtifact` is in the URL, and `evidence` only
 * while the agent has attached files, `pullRequest` only with an Attached pull request. The thread is
 * deliberately absent — in split mode it owns its own column.
 */
export type ThreadSidebarPanelKind = "changes" | "tasks" | "task" | "artifact" | "workflow" | "evidence" | "pullRequest";

/**
 * Tabs of the full-width layout, where the thread is one of them (OS-1396).
 */
export type ThreadWorkspaceTab = "thread" | ThreadSidebarPanelKind;

/** What the Changes panel renders, picked from the changes toolbar selector. */
export type ThreadChangesView =
  /** The newest loaded run with a summary; the default (OS-1882). */
  | { kind: "latest" }
  | { kind: "all" }
  /** Uncommitted changes of the thread's checkout against HEAD (OS-2234). */
  | { kind: "worktree" }
  /** Commit history of the thread's checkout (OS-2535), with the open commit. */
  | { kind: "history"; commit?: string }
  /** A committed run range from the selector's timeline. */
  | { kind: "range"; diffSummary: CliRunDiffSummary; label: string }
  /** A single run scrolled to `file` (opened from a Changes-card row). */
  | { kind: "run"; diffSummary: CliRunDiffSummaryPreview; file: CliRunDiffFile };

/**
 * One tab of the thread workspace. ponytail: a list rather than a fixed union
 * because sub-threads will add more thread tabs (OS-1396) — ids stay opaque
 * strings, so a strip of raw thread ids needs nothing from this component.
 */
export interface ThreadTab<Id extends string = string> {
  id: Id;
  label: string;
  /** Accessible name and tooltip when the icon carries meaning the label lacks ("Watched #7"). */
  ariaLabel?: string;
  icon?: ReactNode;
  /**
   * Rendered inside the tab, before its label, as a sibling of the tab button
   * (the thread tab's task ref) — so the active underline spans it too.
   */
  leading?: ReactNode;
  /**
   * The thread's status glyph (OS-1618), painted in the tab's leading padding
   * rather than in flow. Out of flow on purpose: a tab's width must not depend
   * on its status, or a run finishing would silently resize it and stale the
   * strip's overflow cut (which only re-measures when the tab set changes).
   */
  indicator?: ReactNode;
  /** Renders a trailing close affordance when set. */
  onClose?: () => void;
  /**
   * Renders the tab as finished (done threads): the label is struck through,
   * and the tab stays muted even while it is the active one.
   */
  dimmed?: boolean;
  /**
   * Renders the tab but refuses selection — the panel behind it exists and
   * stays visible in the strip, the caller just can't reach it (a read-only
   * viewer's Changes panel). Prefer this over dropping the tab when the panel
   * is normally there, so the workspace doesn't change shape.
   */
  disabled?: boolean;
  /** Tooltip explaining a `disabled` tab; replaces the label tooltip. */
  disabledReason?: string;
  /** Extra classes for this tab (e.g. a min width for the thread tab). */
  className?: string;
  /** Wraps the rendered tab, e.g. in a context-menu trigger. */
  wrap?: (tab: ReactElement) => ReactElement;
}

export interface ThreadTabListProps<Id extends string> {
  tabs: ThreadTab<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  className?: string;
}

interface ThreadSidebarTabBarProps<Id extends string>
  extends ThreadTabListProps<Id> {
  onCloseSidebar: () => void;
  /** Rendered left of the collapse toggle (the layout mode toggle). */
  trailing?: ReactNode;
}

function tabClasses(active: boolean, dimmed = false, disabled = false): string {
  return cn(
    // max-w keeps a long thread-title tab from crowding out the others.
    // pt-px re-centers content against the 2px underline plus the header
    // strip's -mb-px overhang, so the active tab's task-ref chip sits at the
    // same y as the title-mode header chip.
    "relative flex max-w-64 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 pt-px text-sm",
    active ? "border-foreground" : "border-transparent",
    // A done tab stays muted even while it is the active one — the underline
    // says which tab you are on, the weight says whether it still wants you.
    active && !dimmed
      ? "font-medium text-foreground"
      : "text-muted-foreground hover:text-foreground",
    // Deliberately no `pointer-events-none`: the tab must keep receiving hover
    // so its `disabledReason` tooltip can explain itself.
    disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground"
  );
}

/** Shared with the group strip (`ThreadTabStrip`), which cuts its overflow. */
export function ThreadTabNode<Id extends string>({
  tab,
  active,
  onSelect,
  nodeRef,
  className,
  hidden = false,
  trailingControl,
}: {
  tab: ThreadTab<Id>;
  active: boolean;
  onSelect: (id: Id) => void;
  nodeRef?: (node: HTMLDivElement | null) => void;
  /** Placement classes from the strip's overflow cut. */
  className?: string;
  /** Cut by the overflow: mounted for measurement, out of flow and out of AT. */
  hidden?: boolean;
  /** Rendered at the tab's trailing edge (the strip's overflow chevron). */
  trailingControl?: ReactNode;
}) {
  // Leading content and the close affordance live next to (not inside) the tab
  // button — nested buttons/links are invalid HTML, so the wrapper carries the
  // tab styling.
  const node = (
    <div
      ref={nodeRef}
      data-slot="thread-tab"
      aria-hidden={hidden || undefined}
      // The whole tab selects, not just the label button: the button is
      // content-sized, so a short title ("2") would leave the padding and the
      // task ref beside it inert.
      onClick={(event) => {
        // A link inside the tab (the active tab's task or PR ref) navigates on
        // its own; selecting too would open the host tab's thread menu.
        if (tab.disabled || (event.target as Element).closest("a")) {
          return;
        }
        onSelect(tab.id);
      }}
      className={cn(
        tabClasses(active, tab.dimmed, tab.disabled),
        "gap-2",
        // The glyph's slot, widened only on the tabs that have one (OS-1618): pl-7 leaves room for
        // the indicator plus air on both sides, pr-5 keeps the tab balanced around its label. At
        // the glyph's bare width the dot came out flush against its own task ref.
        tab.indicator && "pl-7 pr-5",
        (tab.onClose || trailingControl) && "pr-1.5",
        tab.className,
        hidden && "pointer-events-none invisible absolute",
        className
      )}
    >
      {/* Out of flow in the tab's leading padding: see `ThreadTab.indicator`.
          The slot spans that padding so the glyph centres in it — clear of the
          label on one side and of the neighbouring tab on the other. Keeps
          pointer events so the glyph's status tooltip works; the click still
          reaches the tab, which is this span's parent. */}
      {tab.indicator ? (
        <span
          data-slot="thread-tab-indicator"
          className="absolute inset-y-0 left-0 flex w-7 items-center justify-center"
        >
          {tab.indicator}
        </span>
      ) : null}
      {tab.leading ? (
        <span className="flex shrink-0 items-center">{tab.leading}</span>
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-disabled={tab.disabled || undefined}
        // The wrapper's handler covers the click; this stays a button for
        // keyboard/AT users.
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 self-stretch",
          tab.disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
        aria-label={tab.ariaLabel}
        title={tab.disabled ? (tab.disabledReason ?? tab.label) : (tab.ariaLabel ?? tab.label)}
      >
        {tab.icon ? (
          <span data-slot="thread-tab-icon" className="flex shrink-0 items-center">
            {tab.icon}
          </span>
        ) : null}
        {/* A done tab says so on the title itself (OS-1594) — no checkmark
            competing with the task-ref chip for the tab's narrow width. */}
        <span className={cn("truncate", tab.dimmed && "line-through")}>{tab.label}</span>
      </button>
      {tab.onClose ? (
        <button
          type="button"
          aria-label={`Close ${tab.label} tab`}
          className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            // Closing must not first select the tab it closes.
            event.stopPropagation();
            tab.onClose?.();
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
      {trailingControl}
    </div>
  );

  return tab.wrap ? tab.wrap(node) : node;
}

/**
 * The underline tabs themselves, without any surrounding chrome — shared by
 * the sidebar tab bar and the full-width layout's thread header.
 */
export function ThreadTabList<Id extends string>({
  tabs,
  activeId,
  onSelect,
  className,
}: ThreadTabListProps<Id>) {
  // Tabs never shrink, so a narrow sidebar scrolls them instead of clipping;
  // no-drag keeps that swipe from dragging the mobile drawer shut.
  return (
    <div
      role="tablist"
      data-vaul-no-drag
      className={cn(
        "no-scrollbar flex min-w-0 items-stretch overflow-x-auto overscroll-x-contain",
        className
      )}
    >
      {tabs.map((tab) => (
        <Fragment key={tab.id}>
          <ThreadTabNode tab={tab} active={tab.id === activeId} onSelect={onSelect} />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Fixed underline tab bar of the thread sidebar (visually matching the task
 * sidebar's Comments/Threads/All activity tabs, at the thread header's
 * height). View selection within Changes lives in `ThreadChangesToolbar`
 * below the tab bar.
 */
export function ThreadSidebarTabBar<Id extends string>({
  tabs,
  activeId,
  onSelect,
  onCloseSidebar,
  trailing,
}: ThreadSidebarTabBarProps<Id>) {
  return (
    <div className="flex h-14 shrink-0 items-stretch border-b border-border pl-1 pr-4">
      <ThreadTabList tabs={tabs} activeId={activeId} onSelect={onSelect} />
      <div className="ml-auto flex shrink-0 items-center gap-1 self-center">
        {trailing}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close thread sidebar"
          className="cursor-pointer"
          onClick={onCloseSidebar}
        >
          <PanelRightClose />
        </Button>
      </div>
    </div>
  );
}

interface ThreadChangesToolbarProps {
  /** Current view shown on the selector: "Latest run", "All changes", "Run 3", "Runs 1-2". */
  label: string;
  changesViewKind: ThreadChangesView["kind"];
  /** Oldest-first, as built by `buildTimelineRuns`; shown in the dropdown. */
  runs: TimelineRun[];
  onSelectView: (kind: (typeof FIXED_VIEWS)[number][0]) => void;
  /** Offers the "Working tree" and "History" items; off for a read-only viewer. */
  showCheckoutViews?: boolean;
  /** Same contract as the run timeline's range commit. */
  onOpenRange: (
    diffSummary: CliRunDiffSummary,
    span: { from: number; to: number }
  ) => void;
  /** Omitted when the caller cannot revert (read-only viewer, or no
   *  profile/path context); the timeline's restore action is then not shown. */
  onRevertRun?: (diffSummary: CliRunDiffSummaryPreview) => void;
  /** True when every file section is collapsed via the toolbar toggle. */
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
  diffStyle: "unified" | "split";
  onToggleDiffStyle: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  /** Off while no diff is on screen (History's list); the toggles would act on nothing. */
  diffToggles?: boolean;
  fileTreeOpen?: boolean;
  onToggleFileTree?: () => void;
  /** Stored PR snapshot of the thread (OS-1370); renders the PR badge when set. */
  pullRequest?: ThreadPullRequest;
}

/** Selector items above the run timeline, in menu order. */
const FIXED_VIEWS = [
  ["latest", "Latest run"],
  ["all", "All changes"],
  ["worktree", "Working tree"],
  ["history", "History"],
] as const;

/**
 * Toolbar row between the tab bar and the Changes panel content. Its selector
 * button shows the active changes view and opens the "Latest run" / "All
 * changes" / "Working tree" / "History" / run timeline dropdown to switch it.
 */
export function ThreadChangesToolbar({
  label,
  changesViewKind,
  runs,
  onSelectView,
  showCheckoutViews = false,
  onOpenRange,
  onRevertRun,
  allCollapsed,
  onToggleCollapseAll,
  diffStyle,
  onToggleDiffStyle,
  wordWrap,
  onToggleWordWrap,
  diffToggles = true,
  fileTreeOpen = false,
  onToggleFileTree,
  pullRequest,
}: ThreadChangesToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // ponytail: 41px, not h-10 — lines up with the sidebar's "New thread" row
    // (py-3 + 20px content + border).
    <div className="flex h-[41px] shrink-0 items-center border-b border-border bg-card px-2">
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted"
          >
            {label}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 overflow-hidden p-0">
          {FIXED_VIEWS.filter(([kind]) => showCheckoutViews || (kind !== "worktree" && kind !== "history")).map(([kind, viewLabel]) => (
            <button
              key={kind}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              onClick={() => {
                setMenuOpen(false);
                onSelectView(kind);
              }}
            >
              <Check
                className={cn(
                  "size-4",
                  changesViewKind === kind ? "opacity-100" : "opacity-0"
                )}
              />
              {viewLabel}
            </button>
          ))}
          <div className="flex max-h-80 flex-col overflow-hidden border-t border-border">
            <RunTimelinePanel
              runs={runs}
              onOpenRange={(diffSummary, span) => {
                setMenuOpen(false);
                onOpenRange(diffSummary, span);
              }}
              onRevertRun={
                onRevertRun
                  ? (diffSummary) => {
                      setMenuOpen(false);
                      onRevertRun(diffSummary);
                    }
                  : undefined
              }
            />
          </div>
        </PopoverContent>
      </Popover>
      <div className="ml-auto flex items-center gap-1">
        {pullRequest ? (
          <ThreadPrBadge pullRequest={pullRequest} className="mr-1" />
        ) : null}
        {diffToggles && (
          <ChangesViewToggles
            allCollapsed={allCollapsed}
            onToggleCollapseAll={onToggleCollapseAll}
            diffStyle={diffStyle}
            onToggleDiffStyle={onToggleDiffStyle}
            wordWrap={wordWrap}
            onToggleWordWrap={onToggleWordWrap}
            fileTreeOpen={fileTreeOpen}
            onToggleFileTree={onToggleFileTree}
          />
        )}
      </div>
    </div>
  );
}
