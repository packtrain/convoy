"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { useWorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";
import { cn } from "@/lib/utils";
import { ChangesSummary, RevertAllButton, WorktreeChangesBody, useSectionCollapse } from "./worktree-changes-body";
import { RevertAllDialog, RevertFileDialog } from "./worktree-revert-dialogs";

interface WorktreeChangesPanelProps {
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

/**
 * The thread Changes tab's "Working tree" view (OS-2234,
 * docs/specs/cli-thread-run-diffs.md): uncommitted changes of the thread's
 * checkout with Refresh, per-file Revert and Revert all.
 */
export function WorktreeChangesPanel({
  profileId,
  pathId,
  allCollapsed,
  diffStyle,
  wordWrap,
  fileTreeOpen,
  refreshKey,
  onMentionFile,
}: WorktreeChangesPanelProps) {
  const state = useWorktreeChanges(profileId, pathId);
  const collapse = useSectionCollapse(allCollapsed);
  const diffOptions = usePatchDiffOptions(diffStyle, wordWrap);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width: treeWidth, handleMouseDown, adjustWidthBy } = useResizePanel(containerRef, {
    bounds: THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS,
  });
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [selectedPath, setSelectedPath] = useState<string>();

  // The mount fetch already covers the current key; only later changes refetch.
  const { refresh } = state;
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKey.current !== refreshKey) {
      lastRefreshKey.current = refreshKey;
      refresh();
    }
  }, [refreshKey, refresh]);

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
          <div className="relative max-w-[60%] shrink-0" style={{ width: treeWidth }}>
            <SidebarResizeHandle
              ariaLabel="Resize file tree"
              currentWidth={treeWidth}
              bounds={THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS}
              expandDirection="left"
              onResizeMouseDown={handleMouseDown}
              onResizeByStep={adjustWidthBy}
              className="absolute inset-y-0 left-0 z-20 -translate-x-1/2"
            />
            <aside aria-label="Changed files" className="h-full overflow-auto border-l border-border">
              <WorktreeFileTree
                files={files}
                selectedPath={state.activeTab ?? selectedPath}
                onSelectFile={selectFile}
                onOpenFile={state.canOpenFile ? state.openFile : undefined}
                onRevertFile={state.setRevertTarget}
                reverting={state.busy}
                onDownloadFile={state.canDownload && !state.busy ? state.requestDownload : undefined}
              />
            </aside>
          </div>
        )}
      </div>
      <RevertFileDialog state={state} />
      <RevertAllDialog state={state} />
    </div>
  );
}
