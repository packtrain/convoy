"use client";

import { useCallback, useRef, useState } from "react";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThreadHeader } from "@/components/blocks/thread/thread-header";
import { ThreadMobileBackButton } from "@/components/blocks/thread/thread-mobile-back-button";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { FileTreeHeader } from "@/components/custom/diff/file-tree-pane";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { appRoute, parseWorktreeChangesTarget, useNavigation, useRouteParams, type WorktreeView } from "@/lib/navigation";
import {
  type ChangesDiffStyle,
  readChangesDiffStyle,
  readChangesWordWrap,
  useFileTreeSide,
  writeChangesDiffStyle,
  writeChangesWordWrap,
} from "@/lib/threads/changes-view-prefs";
import { supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import { useWorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";
import { useHistoryLayout, useWorktreeHistory } from "@/lib/worktrees/hooks/use-worktree-history";
import { useWorktreeRemoval } from "@/lib/worktrees/hooks/use-worktree-removal";
import { cn } from "@/lib/utils";
import { ChangesSummary, RevertAllButton, WorktreeChangesBody, useSectionCollapse } from "./worktree-changes-body";
import { HistoryLayoutToggle, WorktreeHistoryView } from "./worktree-history";
import { RemoveWorktreeDialog } from "./worktree-remove-dialog";
import { RevertAllDialog, RevertFileDialog } from "./worktree-revert-dialogs";

interface WorktreeChangesViewProps {
  profileId: Id<"cliProfiles">;
  pathId: string;
}

/**
 * Uncommitted changes of one checkout as a full page (OS-1980, OS-2036,
 * docs/specs/cli-worktrees.md → Worktree changes view). State lives in
 * `useWorktreeChanges`, shared with the thread sidebar panel.
 */
export function WorktreeChangesView({ profileId, pathId }: WorktreeChangesViewProps) {
  // The host reuses this instance across checkouts; a new one must not inherit tabs or a history cursor.
  return <ChangesViewForCheckout key={`${profileId}:${pathId}`} profileId={profileId} pathId={pathId} />;
}

function ChangesViewForCheckout({ profileId, pathId }: WorktreeChangesViewProps) {
  const params = useRouteParams<{ organizationSlug: string; projectAlias: string }>();
  const state = useWorktreeChanges(profileId, pathId);
  const { location, push, replace } = useNavigation();
  // The tab and the open commit live in the URL, so a reload or Back keeps them (OS-2534).
  const parsed = parseWorktreeChangesTarget(location.search);
  const target = parsed?.profileId === profileId && parsed.pathId === pathId ? parsed : null;
  const tab = target?.view ?? "changes";
  // Changes drops `commit` from the URL; this brings it back on the way to History.
  const [lastCommit, setLastCommit] = useState(target?.commit ?? null);
  // The list is fetched on first open and kept across tab switches.
  const [historyOpenedOnce, setHistoryOpened] = useState(false);
  const historyOpened = historyOpenedOnce || tab === "history";
  const history = useWorktreeHistory(
    profileId,
    pathId,
    historyOpened && state.isOnline && state.entry !== undefined && supportsWorktreeHistory(state.profile?.appVersion)
  );
  const [historyLayout, setHistoryLayout] = useHistoryLayout();
  // History reports whether a commit's diff is on screen; the diff toggles follow it.
  const [historyDiffShown, setHistoryDiffShown] = useState(true);
  const [diffStyle, setDiffStyle] = useState<ChangesDiffStyle>(readChangesDiffStyle);
  const [wordWrap, setWordWrap] = useState(readChangesWordWrap);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const collapse = useSectionCollapse(allCollapsed);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMobile = useIsMobile();
  const treeSide = useFileTreeSide();
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const diffOptions = usePatchDiffOptions(diffStyle, wordWrap);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removal = useWorktreeRemoval(profileId, {
    onRemoved: () => push(appRoute.projectThreads(params.organizationSlug, params.projectAlias)),
  });

  const toggleDiffStyle = useCallback(() => {
    setDiffStyle((value) => {
      const next = value === "unified" ? "split" : "unified";
      writeChangesDiffStyle(next);
      return next;
    });
  }, []);
  const toggleWordWrap = useCallback(() => {
    setWordWrap((value) => {
      writeChangesWordWrap(!value);
      return !value;
    });
  }, []);
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) {
      sectionRefs.current.set(path, element);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);
  // Sections stay mounted while collapsed, so the scroll target always exists.
  const selectFile = (path: string) => {
    setSelectedPath(path);
    state.selectTab(null);
    if (collapse.isCollapsed(path)) {
      collapse.toggle(path);
    }
    sectionRefs.current.get(path)?.scrollIntoView({ block: "start" });
  };

  const { profile, entry, isOnline, sections, files, changes } = state;
  if (profile === undefined) {
    return null;
  }

  const title = entry ? (entry.kind === "worktree" ? (entry.branch ?? entry.label) : entry.label) : "Changes";
  const hasFiles = sections !== null && files.length > 0;
  const onHistory = tab === "history";
  const phoneCommit = isMobile && onHistory && target?.commit != null;
  const noDiffShown = onHistory && !historyDiffShown;
  const route = (view: WorktreeView, commit: string | null) =>
    appRoute.projectThreadsWithPreselection(params.organizationSlug, params.projectAlias, { profileId, pathId, view, commit });
  const openTab = (next: WorktreeView) => {
    if (next === tab) {
      return;
    }
    if (next === "history") {
      setHistoryOpened(true);
    } else {
      setLastCommit(target?.commit ?? null);
    }
    replace(route(next, next === "history" ? lastCommit : null));
  };
  const selectCommit = (commit: string | null, mode: "push" | "replace" | "back") => {
    if (mode === "back") {
      window.history.back();
    } else {
      (mode === "push" ? push : replace)(route("history", commit));
    }
  };
  const refreshing = onHistory ? history.initialLoading || history.refreshing : changes.loading;
  return (
    // minmax(0,1fr) column: an auto column takes the longest diff line's width and overflows a phone viewport.
    <main
        className={cn(
          "grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden",
          entry ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"
        )}
      >
        <ThreadHeader
          title={title}
          leading={<ThreadMobileBackButton organizationSlug={params.organizationSlug} projectAlias={params.projectAlias} />}
          actions={
            entry && isOnline ? (
              <>
                {/* aria-disabled, not disabled: a disabled button drops keyboard focus mid-refresh. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer gap-1.5 text-xs aria-disabled:opacity-50"
                  onClick={() => {
                    if (!refreshing) {
                      (onHistory ? history.refresh : state.refresh)();
                    }
                  }}
                  aria-disabled={refreshing}
                  aria-label={onHistory ? "Refresh history" : "Refresh changes"}
                >
                  <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
                  Refresh
                </Button>
                {entry.kind === "worktree" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="cursor-pointer" aria-label="More actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {/* The CLI refuses a dirty worktree; the patch on screen says so up front. */}
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={hasFiles || removal.removingPathId !== null}
                        onSelect={() => setConfirmRemove(true)}
                      >
                        <Trash2 />
                        <span className="flex flex-col">
                          Remove worktree
                          {hasFiles && <span className="text-xs text-muted-foreground">Commit or revert changes first</span>}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            ) : undefined
          }
        />
        {/* ponytail: 41px like ThreadChangesToolbar — lines up with the sidebar's "New thread" row. */}
        {entry && (
          <div className="flex h-[41px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-xs text-muted-foreground">
            <Tabs value={tab} onValueChange={(value) => openTab(value === "history" ? "history" : "changes")} className="shrink-0">
              <TabsList variant="underline" className="w-auto border-b-0" aria-label="Worktree view">
                <TabsTrigger value="changes">
                  Changes
                  {hasFiles && <span className="rounded-sm bg-muted px-1 text-xs tabular-nums">{files.length}</span>}
                </TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </Tabs>
            {/* A phone has room for a few characters only; the header names the checkout. */}
            {!isMobile && (
              <span className="truncate font-mono" title={entry.path}>
                {entry.path}
              </span>
            )}
            {!onHistory && <ChangesSummary files={files} />}
            {isOnline && !onHistory && <RevertAllButton state={state} />}
            <div className="ml-auto flex items-center gap-1">
              {/* The diff toggles only while a diff is on screen, left of List | Graph so it never moves. */}
              {!noDiffShown && (
                <ChangesViewToggles
                  allCollapsed={allCollapsed}
                  onToggleCollapseAll={() => setAllCollapsed((value) => !value)}
                  diffStyle={diffStyle}
                  onToggleDiffStyle={toggleDiffStyle}
                  wordWrap={wordWrap}
                  onToggleWordWrap={toggleWordWrap}
                  fileTreeOpen={sidebarOpen}
                  onToggleFileTree={hasFiles && !isMobile && !onHistory ? () => setSidebarOpen((open) => !open) : undefined}
                />
              )}
              {/* A phone's commit pane drops the layout toggle. */}
              {onHistory && !phoneCommit && <HistoryLayoutToggle value={historyLayout} onChange={setHistoryLayout} />}
            </div>
          </div>
        )}
        {/* Header and tabs row span the full width, so switching tabs never moves them. */}
        <ThreadWorkspaceSplitPane
          isSidebarOpen={sidebarOpen && hasFiles && !isMobile && !onHistory}
          onCloseSidebar={() => setSidebarOpen(false)}
          sidebarTitle="Files"
          sidebarHeader={<FileTreeHeader levelWith="section" onClose={() => setSidebarOpen(false)} />}
          sidebarSide={treeSide}
          sidebarContent={
            <WorktreeFileTree
              files={files}
              selectedPath={selectedPath}
              onSelectFile={selectFile}
              onOpenFile={state.canOpenFile ? state.openFile : undefined}
              onRevertFile={state.setRevertTarget}
              reverting={state.busy}
              onDownloadFile={state.canDownload && !state.busy ? state.requestDownload : undefined}
            />
          }
        >
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden">
            {onHistory ? (
              <WorktreeHistoryView
                profileId={profileId}
                pathId={pathId}
                history={history}
                layout={historyLayout}
                registered={entry !== undefined}
                isOnline={isOnline}
                appVersion={profile?.appVersion}
                diffOptions={diffOptions}
                allCollapsed={allCollapsed}
                wordWrap={wordWrap}
                selectedHash={target?.commit ?? null}
                onSelect={selectCommit}
                onDiffShownChange={setHistoryDiffShown}
              />
            ) : (
              <div className="flex min-h-0 flex-col">
                <FileTabStrip activeTab={state.activeTab} openPaths={state.openPaths} onSelect={state.selectTab} onClose={state.closeFileTab} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <WorktreeChangesBody
                    state={state}
                    diffOptions={diffOptions}
                    wordWrap={wordWrap}
                    isCollapsed={collapse.isCollapsed}
                    onToggle={collapse.toggle}
                    registerSection={registerSection}
                  />
                </div>
              </div>
            )}
          </div>
        </ThreadWorkspaceSplitPane>
        <RevertFileDialog state={state} />
        <RevertAllDialog state={state} />
        <RemoveWorktreeDialog
          worktree={confirmRemove && entry ? entry : null}
          onClose={() => setConfirmRemove(false)}
          onConfirm={(worktree) => void removal.remove(worktree.id)}
        />
      </main>
  );
}
