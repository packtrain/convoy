"use client";

import {
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { AppLink, appRoute, useRouteParams } from "@/lib/navigation";
import { useQuery } from "convex/react";
import { ArrowUpRight, Bot, ChevronLeft, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import { ThreadListItem } from "@/components/blocks/thread/thread-list-item";
import { ThreadMiniPreview } from "@/components/blocks/thread/thread-mini-preview";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { EmptyValue } from "@/components/blocks/tasks/task-table/badges";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { slashCommandDisplayText } from "@/lib/slash-commands/display";
import type { Task, TaskAgentThreadWorkEntry } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { AgentThreadWorkStatusDot } from "./agent-thread-work-status";

// 2 stacked size-5 badges at -ml-2.5 overlap = 30px, fitting the w-10 column.
// Beyond that the second slot becomes a "+N" counter instead of more icons.
const MAX_STACKED_ICONS = 2;

function AgentThreadWorkBadge({
  entry,
  className,
  style,
}: {
  entry: TaskAgentThreadWorkEntry;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "relative flex size-5 shrink-0 items-center justify-center rounded-full bg-background",
        className
      )}
      style={style}
    >
      {isCliType(entry.cliType) ? (
        <span className="[&>svg]:size-3">{renderCliIcon(entry.cliType, "size-3")}</span>
      ) : (
        <Bot className="size-3 text-muted-foreground" />
      )}
      <AgentThreadWorkStatusDot status={entry.status} className="absolute right-0 bottom-0 size-1.5" />
    </span>
  );
}

/**
 * Agent-work column cell (OS-1094): stacked CLI-icon badges (latest on top) with each
 * entry's status dot, or a dash when the task has no agent threads.
 *
 * Clicking opens a popover with the viewer's latest own thread in a mini preview
 * (OS-1130) under a back / "Start new" / open-full header. Back shows the plain thread
 * list; "Start new" opens the task-attached composer. Without own threads that composer
 * shows directly, focused for typing. Without threads access (viewers) only the badges show.
 */
export function AgentThreadWorkCell({
  task,
  projectId,
  canUseThreads,
}: {
  task: Task;
  projectId?: Id<"projects">;
  canUseThreads: boolean;
}) {
  const params = useRouteParams<{ organizationSlug?: string; projectAlias?: string }>();
  const organizationSlug = params?.organizationSlug;
  const projectAlias = params?.projectAlias;
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const entries = [...(task.agentThreadWork ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const stacked = entries.slice(0, entries.length > MAX_STACKED_ICONS ? 1 : MAX_STACKED_ICONS);
  const overflowCount = entries.length - stacked.length;

  const badges =
    entries.length > 0 ? (
      <span className="flex items-center">
        {stacked.map((entry, index) => (
          <AgentThreadWorkBadge
            key={entry.threadId}
            entry={entry}
            className={cn(index > 0 && "-ml-2.5")}
            style={{ zIndex: stacked.length + 1 - index }}
          />
        ))}
        {overflowCount > 0 && (
          <span className="z-0 -ml-2.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground">
            +{overflowCount}
          </span>
        )}
      </span>
    ) : (
      <EmptyValue />
    );

  // Outside a project route (or without a project or threads access) there is nothing to open.
  if (!projectId || !organizationSlug || !projectAlias || !canUseThreads) {
    return (
      <span className="flex h-9 w-full items-center justify-center">
        {badges}
      </span>
    );
  }

  const trigger = (
    <button
      type="button"
      aria-label="Task agent threads"
      onClick={(event) => event.stopPropagation()}
      className="flex h-9 w-full cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {badges}
    </button>
  );

  const overlayContent = (
    <AgentThreadWorkOverlayContent
      projectId={projectId}
      organizationSlug={organizationSlug}
      projectAlias={projectAlias}
      task={task}
      // pb keeps the drawer content clear of the floating mobile nav.
      className={isMobile ? "max-h-none min-h-0 flex-1 pb-(--mobile-nav-clearance)" : undefined}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen} direction="bottom">
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        {/* No stopPropagation here: it would also cancel the native event
            before Radix's document-level tap-outside dismissal sees it; the
            task row ignores portal-bubbled events instead. */}
        <DrawerContent
          data-testid="agent-thread-work-drawer"
          className="max-h-[80dvh] overflow-hidden bg-popover p-0 text-popover-foreground"
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>Task agent threads</DrawerTitle>
            <DrawerDescription>
              View active threads or start a new thread for this task.
            </DrawerDescription>
          </DrawerHeader>
          {overlayContent}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[30rem] overflow-hidden border border-border bg-popover p-0 text-popover-foreground ring-0"
      >
        {overlayContent}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One-line overlay header: back button (disabled when there is no list to go
 * back to), title, optional actions, open-full link.
 */
function OverlayHeader({
  title,
  onBack,
  fullHref,
  fullAriaLabel,
  children,
}: {
  title: string;
  onBack?: () => void;
  fullHref: ComponentProps<typeof AppLink>["href"];
  fullAriaLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(onBack && "cursor-pointer")}
        aria-label="Back to thread list"
        disabled={!onBack}
        onClick={onBack}
      >
        <ChevronLeft />
      </Button>
      <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h4>
      {children}
      <Button asChild variant="ghost" size="icon-sm" className="cursor-pointer">
        <AppLink href={fullHref} aria-label={fullAriaLabel}>
          <ArrowUpRight />
        </AppLink>
      </Button>
    </div>
  );
}

function AgentThreadWorkOverlayContent({
  projectId,
  organizationSlug,
  projectAlias,
  task,
  className,
}: {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  task: Task;
  className?: string;
}) {
  const threads = useQuery(api.cli.threads.lists.listByAssociatedTask, { projectId, taskId: task._id });
  const isLoading = threads === undefined;
  // Which of the viewer's own threads is open in the mini preview: null means
  // "auto" (latest own thread once loaded), "list" is the plain thread list,
  // "new" is the new-thread composer view.
  const [selection, setSelection] = useState<Id<"cliThreads"> | "list" | "new" | null>(null);
  // While the query loads, show one skeleton per stored work entry — the list
  // can only end up with that many rows or more, never fewer.
  const skeletonCount = task.agentThreadWork?.length ?? 0;
  // Entries not among the viewer's own threads belong to other users. Wait for
  // the query so rows don't flash as info-only before their thread loads.
  const ownThreadIds = new Set((threads ?? []).map((thread) => thread._id));
  const otherUsersEntries = isLoading
    ? []
    : [...(task.agentThreadWork ?? [])]
        .filter((entry) => !ownThreadIds.has(entry.threadId))
        .sort((a, b) => b.updatedAt - a.updatedAt);

  const latestThread =
    threads && threads.length > 0
      ? threads.reduce((latest, thread) =>
          thread.lastActivityAt > latest.lastActivityAt ? thread : latest
        )
      : null;
  // A just-created thread may not be in the query results yet — preview by id
  // and fall back to a placeholder title until it loads.
  const previewThreadId =
    selection === "list" || selection === "new" ? null : (selection ?? latestThread?._id ?? null);
  const previewThread = threads?.find((thread) => thread._id === previewThreadId);

  // Plain left-clicks on a row open the mini preview instead of navigating
  // (preventDefault in capture phase stops the Next.js Link); modified clicks
  // keep the browser's open-in-new-tab behavior on the full thread page.
  const interceptRowClick =
    (threadId: Id<"cliThreads">) => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      setSelection(threadId);
    };

  const renderThreadRow = (thread: NonNullable<typeof threads>[number]) => (
    <div key={thread._id} onClickCapture={interceptRowClick(thread._id)}>
      <ThreadListItem
        chat={thread}
        isActive={false}
        compactLayout
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        showAssociatedTask={false}
        showActions={false}
        rowClassName="bg-popover"
      />
    </div>
  );

  const infoRows = otherUsersEntries.map((entry) => (
    <CompactThreadRowContent
      key={entry.threadId}
      title={entry.threadTitle}
      status={entry.status}
      cliType={entry.cliType}
      lastActivityAt={entry.updatedAt}
      forceStatusIndicator
      userName={entry.userName}
      className="border-b border-border"
    />
  ));

  // View 1: mini thread preview — header + embedded thread, nothing else.
  if (previewThreadId) {
    return (
      <div className={cn("flex h-[min(70vh,36rem)] flex-col", className)}>
        <OverlayHeader
          title={slashCommandDisplayText(previewThread?.title || "New thread")}
          onBack={() => setSelection("list")}
          fullHref={appRoute.projectThreadDetail(
            organizationSlug,
            projectAlias,
            String(previewThreadId)
          )}
          fullAriaLabel="Open full thread"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer px-2 text-xs"
            onClick={() => setSelection("new")}
          >
            <Plus className="size-3.5" />
            Start new
          </Button>
        </OverlayHeader>
        <ThreadMiniPreview
          key={String(previewThreadId)}
          threadId={previewThreadId}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
        />
      </div>
    );
  }

  // View 2: new-thread composer — via an explicit "Start new" (own threads
  // exist, back returns to the list) or as the initial view when the viewer
  // has none (back disabled; other users' work still listed for context).
  if (selection === "new" || (isLoading ? skeletonCount === 0 : (threads?.length ?? 0) === 0)) {
    const isInitialComposer = selection !== "new";
    const showInfoRows = isInitialComposer && infoRows.length > 0;
    return (
      <div className={cn("flex max-h-[min(70vh,36rem)] flex-col", className)}>
        <OverlayHeader
          title="New thread"
          onBack={isInitialComposer ? undefined : () => setSelection("list")}
          fullHref={appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
            attachedTask: task.refId,
          })}
          fullAriaLabel="Open full page"
        />
        {showInfoRows ? (
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [&>*:last-child]:border-b-0">
            {infoRows}
          </div>
        ) : null}
        <TaskThreadComposer
          projectId={projectId}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          task={task}
          autoFocus
          onThreadCreated={setSelection}
          // The rule separates the composer from the info rows above it, so it
          // is only wanted when there are any.
          bordered={showInfoRows}
          // max-md:pb-2 cancels the composer's own mobile-nav clearance —
          // the drawer wrapper already provides it.
          composerContainerClassName="p-2 max-md:pb-2"
          composerTextareaClassName="min-h-12 p-2.5"
          className="shrink-0"
        />
      </div>
    );
  }

  // View 3: thread list — skeletons while loading, then a "Start new" row,
  // the viewer's own threads, and other users' info rows.
  return (
    <div className={cn("flex max-h-[min(70vh,36rem)] flex-col", className)}>
      {isLoading ? (
        <div className="min-h-0 flex-1 overflow-hidden [&>*:last-child]:border-b-0">
          {Array.from({ length: skeletonCount }, (_, index) => (
            <div key={index} className="flex items-center gap-2 border-b border-border px-3 py-3">
              <Skeleton className="size-2 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="size-3.5 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [&>*:last-child]:border-b-0">
          <button
            type="button"
            onClick={() => setSelection("new")}
            className="flex w-full cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="size-3.5 shrink-0" />
            Start new
          </button>
          {threads?.map(renderThreadRow)}
          {infoRows}
        </div>
      )}
    </div>
  );
}
