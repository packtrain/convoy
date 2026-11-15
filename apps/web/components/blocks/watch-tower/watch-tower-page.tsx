"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { useHotkey } from "@tanstack/react-hotkeys";
import { LayoutGrid, List, ListFilter, TowerControl } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppLink, appRoute, useRouteParams } from "@/lib/navigation";
import { getLastProjectAlias } from "@/lib/routing/last-project-storage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/custom/empty-state";
import { useWatchTowerSection } from "@/lib/watch-tower/use-watch-tower-threads";
import {
  EMPTY_THREAD_BATCH_SELECTION,
  toggleThreadBatchSelection,
} from "@/lib/threads/thread-batch-selection";
import {
  WATCH_TOWER_SECTIONS,
  watchTowerSections,
  readWatchTowerScope,
  writeWatchTowerScope,
  type WatchTowerScope,
  readHiddenWatchTowerSections,
  readWatchTowerViewMode,
  writeHiddenWatchTowerSections,
  writeWatchTowerViewMode,
  type WatchStatus,
  type WatchTowerViewMode,
} from "@/lib/watch-tower/watch-tower-view";
import { cn } from "@/lib/utils";
import { ThreadBoard } from "./thread-board";
import { StatusSections, StatusSectionsSkeleton } from "./thread-list";
import type { BatchAction, SectionData, SectionSelection } from "./types";

/**
 * The page's only toolbar control: the layout choice and the section filter are
 * both "what am I looking at" settings, so they share one dropdown rather than
 * competing for header width (OS-1595).
 */
function ViewSettingsDropdown({
  viewMode,
  scope,
  onScopeChange,
  isProject,
  hidden,
  onViewModeChange,
  onToggle,
}: {
  viewMode: WatchTowerViewMode;
  scope: WatchTowerScope;
  isProject: boolean;
  onScopeChange: (scope: WatchTowerScope) => void;
  hidden: Set<string>;
  onViewModeChange: (mode: WatchTowerViewMode) => void;
  onToggle: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="View settings"
          className="cursor-pointer"
        >
          <ListFilter className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {isProject ? (
          <>
            <DropdownMenuLabel>Threads</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scope} onValueChange={(value) => onScopeChange(value === "all" ? "all" : "mine")}>
              <DropdownMenuRadioItem value="all">All threads</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mine">Only mine</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={viewMode}
          onValueChange={(value) => onViewModeChange(value as WatchTowerViewMode)}
        >
          <DropdownMenuRadioItem value="list">
            <List className="size-3.5 text-muted-foreground" />
            List
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="board">
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            Board
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sections</DropdownMenuLabel>
        {watchTowerSections(scope).map((section) => (
          <DropdownMenuItem
            key={section.status}
            className="cursor-pointer gap-2"
            onSelect={(event) => {
              event.preventDefault();
              onToggle(section.status);
            }}
          >
            {/* **:…! needed: the item's focus:**:text-accent-foreground recolors the check path directly, tick goes white-on-white on hover */}
            <Checkbox
              checked={!hidden.has(section.status)}
              aria-label={`Show ${section.title}`}
              className="pointer-events-none **:text-primary-foreground!"
            />
            {section.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WatchTowerPage() {
  const { organizationSlug, projectAlias } = useRouteParams<{ organizationSlug: string; projectAlias?: string }>();
  return <WatchTowerContent key={`${organizationSlug}/${projectAlias ?? ""}`}
    organizationSlug={organizationSlug} projectAlias={projectAlias} />;
}

function WatchTowerContent({ organizationSlug, projectAlias }: { organizationSlug: string; projectAlias?: string }) {
  const { isAuthenticated } = useAppConvexAuth();
  // Lazy init from localStorage is hydration-safe here: the org layout holds
  // its own loading state until auth resolves, so this never server-renders.
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(
    readHiddenWatchTowerSections
  );
  const projectKey = `${organizationSlug}/${projectAlias ?? ""}`;
  const [scope, setScope] = useState<WatchTowerScope>(() => projectAlias ? readWatchTowerScope(projectKey) : "mine");
  const [viewMode, setViewMode] = useState<WatchTowerViewMode>(readWatchTowerViewMode);

  // One independently paginated query per section (OS-1259); hidden sections
  // skip their query entirely.
  const slug = isAuthenticated ? organizationSlug : undefined;
  const slugFor = (section: WatchStatus) =>
    hiddenSections.has(section) ? undefined : slug;
  const project = projectAlias ? { projectAlias, scope } : undefined;
  const sections: Record<WatchStatus, SectionData> = {
    running: useWatchTowerSection(slugFor("running"), "running", project),
    waiting_input: useWatchTowerSection(slugFor("waiting_input"), "waiting_input", project),
    failed: useWatchTowerSection(slugFor("failed"), "failed", project),
    needs_review: useWatchTowerSection(slugFor("needs_review"), "needs_review", project),
    done: useWatchTowerSection(slugFor("done"), "done", project),
  };
  const visibleSections = WATCH_TOWER_SECTIONS.filter(
    (section) => !hiddenSections.has(section.status)
  ).map((section) => sections[section.status]);
  const hasVisibleRows = visibleSections.some(
    (data) => data.threads.length > 0
  );
  const allVisibleSettled =
    visibleSections.length > 0 &&
    visibleSections.every((data) => data.status === "Exhausted");
  const isLoadingFirstPage = visibleSections.some(
    (data) => data.status === "LoadingFirstPage"
  );
  const [selection, setSelection] = useState<SectionSelection | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<
    Id<"cliThreads">[] | null
  >(null);
  const batchMarkRead = useMutation(api.cli.threads.batch.batchMarkRead);
  const batchMarkDone = useMutation(api.cli.threads.batch.batchMarkDone);
  const batchMarkNotDone = useMutation(api.cli.threads.batch.batchMarkNotDone);
  const batchRemove = useMutation(api.cli.threads.batch.batchRemove);

  useHotkey("Escape", () => setSelection(null), {
    enabled: selection !== null && pendingDeleteIds === null,
  });

  const toggleSection = (key: string) => {
    const next = new Set(hiddenSections);
    if (!next.delete(key)) next.add(key);
    setHiddenSections(next);
    writeHiddenWatchTowerSections(next);
  };

  const changeScope = (next: WatchTowerScope) => {
    setScope(next);
    writeWatchTowerScope(projectKey, next);
    setSelection(null);
    setPendingDeleteIds(null);
  };

  const changeViewMode = (mode: WatchTowerViewMode) => {
    setViewMode(mode);
    writeWatchTowerViewMode(mode);
    // A selection belongs to a section's rendered order, which the other
    // layout re-derives; clearing avoids acting on a stale visible set.
    setSelection(null);
  };

  const toggleSelect = (
    section: WatchStatus,
    orderedIds: Id<"cliThreads">[],
    threadId: Id<"cliThreads">,
    shiftKey: boolean
  ) => {
    setSelection((prev) => {
      const base =
        prev?.section === section
          ? prev
          : { section, ...EMPTY_THREAD_BATCH_SELECTION };
      const next = toggleThreadBatchSelection(
        base,
        orderedIds,
        threadId,
        shiftKey
      );
      return next.ids.length === 0 ? null : { section, ...next };
    });
  };

  const runBatchAction = async (
    action: BatchAction,
    ids: Id<"cliThreads">[]
  ) => {
    if (action === "delete") {
      setPendingDeleteIds(ids);
      return;
    }
    const mutations = {
      markRead: batchMarkRead,
      markDone: batchMarkDone,
      markNotDone: batchMarkNotDone,
    };
    await mutations[action]({ threadIds: ids });
    setSelection(null);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteIds) return;
    await batchRemove({ threadIds: pendingDeleteIds });
    setPendingDeleteIds(null);
    setSelection(null);
  };

  const isBoard = viewMode === "board";

  // The header stays mounted while loading: the list skeletons its rows and
  // the board lets each column show its own spinner.
  const isListLoading = !isBoard && (!isAuthenticated || isLoadingFirstPage);

  // With no rows and no filter applied, the settings have nothing to act on.
  const isFiltered = hiddenSections.size > 0 || (projectAlias !== undefined && scope === "mine");
  const isUnfilteredEmpty = !isBoard && !hasVisibleRows && allVisibleSettled && !isFiltered;
  const threadsAlias = projectAlias ?? getLastProjectAlias(organizationSlug);

  const toolbar = isUnfilteredEmpty ? null : (
    <ViewSettingsDropdown
      viewMode={viewMode}
      scope={scope}
      onScopeChange={changeScope}
      isProject={projectAlias !== undefined}
      hidden={hiddenSections}
      onViewModeChange={changeViewMode}
      onToggle={toggleSection}
    />
  );

  const emptyState = (testId?: string) => (
    <EmptyState
      fill
      data-testid={testId}
      icon={TowerControl}
      title="Nothing to watch yet"
      description={
        projectAlias
          ? "Agent runs in this project will appear here."
          : "Your agent runs across this organization's projects will appear here."
      }
      action={
        threadsAlias ? (
          <Button variant="secondary" asChild>
            <AppLink href={appRoute.projectThreads(organizationSlug, threadsAlias)}>
              Start a thread
            </AppLink>
          </Button>
        ) : null
      }
    />
  );

  return (
    <main
      className={cn(
        "bg-background text-foreground",
        // The board is a full-height horizontal scroller inside the sidebar
        // inset; the list keeps its own vertical scroll and centered column.
        isBoard
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "flex min-h-screen flex-col overflow-y-auto"
      )}
    >
      {/* The board's header is a full-bleed bar: its bottom border doubles as
          the top edge of the column strip, so the two read as one surface. */}
      {isBoard ? (
        // Matches the project task views' header bar (h-14, px-4, text-sm
        // font-medium): a full-height board is an app surface, so its title
        // belongs on the app chrome scale, not the page-title one the list uses.
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <h1 className="truncate text-sm font-medium">Watch Tower</h1>
          {toolbar}
        </header>
      ) : null}
      <div className={cn(isBoard ? "flex min-h-0 flex-1 flex-col" : "flex flex-1 flex-col px-6 py-6")}>
        <div
          className={cn(
            isBoard
              ? "flex min-h-0 flex-1 flex-col"
              : "mx-auto flex w-full max-w-5xl flex-1 flex-col"
          )}
        >
          {isBoard ? null : (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Watch Tower</h1>
              {toolbar}
            </div>
          )}

          {isBoard ? (
            visibleSections.length === 0 ? (
              emptyState()
            ) : (
              // pb on mobile clears the bottom nav bar, which overlays the inset.
              <div data-testid="watch-tower-board" className="min-h-0 flex-1 max-md:pb-14">
                <ThreadBoard
                  scope={scope}
                  sections={sections}
                  hidden={hiddenSections}
                  organizationSlug={organizationSlug}
                  selection={selection}
                  isLoadingSection={(status) =>
                    sections[status].status === "LoadingFirstPage"
                  }
                  onToggleSelect={toggleSelect}
                  onBatchAction={runBatchAction}
                  onClearSelection={() => setSelection(null)}
                />
              </div>
            )
          ) : isListLoading ? (
            <StatusSectionsSkeleton />
          ) : hasVisibleRows ? (
            <StatusSections
              scope={scope}
              sections={sections}
              hidden={hiddenSections}
              organizationSlug={organizationSlug}
              selection={selection}
              onToggleSelect={toggleSelect}
              onBatchAction={runBatchAction}
              onClearSelection={() => setSelection(null)}
            />
          ) : allVisibleSettled || visibleSections.length === 0 ? (
            emptyState("watch-tower-empty")
          ) : (
            // Sections auto-loading past fully-filtered pages (see hook).
            <StatusSectionsSkeleton />
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => !open && setPendingDeleteIds(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {pendingDeleteIds?.length === 1
                ? "thread"
                : `${pendingDeleteIds?.length ?? 0} threads`}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected threads will be permanently deleted. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
