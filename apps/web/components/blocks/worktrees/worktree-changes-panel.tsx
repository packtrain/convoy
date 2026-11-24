"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RefreshCw } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { FileTreePane } from "@/components/custom/diff/file-tree-pane";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import { useWorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";
import { useHistoryLayout, useWorktreeHistory } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ChangesSummary, RevertAllButton, WorktreeChangesBody, useSectionCollapse } from "./worktree-changes-body";
import { HistoryLayoutToggle, WorktreeHistoryView } from "./worktree-history";
import { RevertAllDialog, RevertFileDialog } from "./worktree-revert-dialogs";

interface WorktreeChangesPanelProps {
  /** "Working tree" or "History" in the thread's view selector. */
  view: "worktree" | "history";
  profileId: Id<"cliProfiles">;
  pathId: string;
  /** Toolbar toggles, owned by the thread's Changes toolbar. */
  allCollapsed: boolean;
  diffStyle: "unified" | "split";
  wordWrap: boolean;
  fileTreeOpen: boolean;
  /** A change refetches the patch, e.g. the newest run's `postRef`. */
  refreshKey?: string;
  onMentionFile?: (path: string) => void;
}

/** The thread Changes tab's views of its checkout (docs/specs/cli-thread-run-diffs.md). */
export function WorktreeChangesPanel({ view, ...props }: WorktreeChangesPanelProps) {
  return view === "history" ? <HistoryPanel {...props} /> : <WorkingTreePanel {...props} />;
}

/** Calls `refresh` when `refreshKey` changes; the mount fetch already covers the first key. */
function useRefreshOnKey(refreshKey: string | undefined, refresh: () => void) {
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKey.current !== refreshKey) {
      lastRefreshKey.current = refreshKey;
      refresh();
    }
  }, [refreshKey, refresh]);
}

type PanelProps = Omit<WorktreeChangesPanelProps, "view">;

/** "History" (OS-2535): the worktree page's History view, one pane at a time at this width. */
function HistoryPanel({ profileId, pathId, allCollapsed, diffStyle, wordWrap, refreshKey }: PanelProps) {
  const profile = useQuery(api.cli.profiles.get, { profileId });
  const isOnline = profile?.isOnline ?? false;
  const entry = profile?.paths.find((path) => path.id === pathId);
  const canFetch = isOnline && entry !== undefined && supportsWorktreeHistory(profile?.appVersion);
  const history = useWorktreeHistory(profileId, pathId, canFetch);
  const diffOptions = usePatchDiffOptions(diffStyle, wordWrap);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [layout, setLayout] = useHistoryLayout();
  useRefreshOnKey(refreshKey, history.refresh);
  if (profile === undefined) {
    return null;
  }
  const refreshing = history.initialLoading || history.refreshing;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {canFetch && (
        <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
          <HistoryLayoutToggle value={layout} onChange={setLayout} />
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus mid-refresh. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 cursor-pointer gap-1.5 text-xs aria-disabled:opacity-50"
            onClick={() => {
              if (!refreshing) {
                history.refresh();
              }
            }}
            aria-disabled={refreshing}
            aria-label="Refresh history"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <WorktreeHistoryView
          profileId={profileId}
          pathId={pathId}
          history={history}
          layout={layout}
          registered={entry !== undefined}
          isOnline={isOnline}
          appVersion={profile?.appVersion}
          diffOptions={diffOptions}
          allCollapsed={allCollapsed}
          wordWrap={wordWrap}
          selectedHash={selectedHash}
          onSelect={setSelectedHash}
        />
      </div>
    </div>
  );
}

/**
 * "Working tree" (OS-2234): uncommitted changes of the thread's checkout with
 * Refresh, per-file Revert and Revert all.
 */
function WorkingTreePanel({
  profileId,
  pathId,
  allCollapsed,
  diffStyle,
  wordWrap,
  fileTreeOpen,
  refreshKey,
  onMentionFile,
}: PanelProps) {
  const state = useWorktreeChanges(profileId, pathId);
  const collapse = useSectionCollapse(allCollapsed);
  const diffOptions = usePatchDiffOptions(diffStyle, wordWrap);
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [selectedPath, setSelectedPath] = useState<string>();

  useRefreshOnKey(refreshKey, state.refresh);

  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) {
      sectionRefs.current.set(path, element);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);
  const selectFile = (path: string) => {
    setSelectedPath(path);
    state.selectTab(null);
    if (collapse.isCollapsed(path)) {
      collapse.toggle(path);
    }
    sectionRefs.current.get(path)?.scrollIntoView({ block: "start" });
  };

  const { entry, isOnline, files, changes } = state;
  const showTree = fileTreeOpen && state.sections !== null && files.length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {entry && isOnline && state.cliSupported && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
          <ChangesSummary files={files} />
          <div className="ml-auto flex items-center gap-1">
            <RevertAllButton state={state} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 cursor-pointer gap-1.5 text-xs"
              onClick={state.refresh}
              disabled={changes.loading}
              aria-label="Refresh changes"
            >
              <RefreshCw className={cn("size-3.5", changes.loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      )}
      <FileTabStrip
        activeTab={state.activeTab}
        openPaths={state.openPaths}
        changesLabel="Working tree"
        onSelect={state.selectTab}
        onClose={state.closeFileTab}
      />
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <WorktreeChangesBody
            state={state}
            diffOptions={diffOptions}
            wordWrap={wordWrap}
            isCollapsed={collapse.isCollapsed}
            onToggle={collapse.toggle}
            registerSection={registerSection}
            onMentionFile={onMentionFile}
          />
        </div>
        {showTree && (
          <FileTreePane containerRef={containerRef}>
            <WorktreeFileTree
              files={files}
              selectedPath={state.activeTab ?? selectedPath}
              onSelectFile={selectFile}
              onOpenFile={state.canOpenFile ? state.openFile : undefined}
              onRevertFile={state.setRevertTarget}
              reverting={state.busy}
              onDownloadFile={state.canDownload && !state.busy ? state.requestDownload : undefined}
            />
          </FileTreePane>
        )}
      </div>
      <RevertFileDialog state={state} />
      <RevertAllDialog state={state} />
    </div>
  );
}
