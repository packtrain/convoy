"use client";

import { useCallback, useRef, useState } from "react";
import { PanelRight, RefreshCw } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ThreadHeader } from "@/components/blocks/thread/thread-header";
import { ThreadMobileBackButton } from "@/components/blocks/thread/thread-mobile-back-button";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { useRouteParams } from "@/lib/navigation";
import {
  type ChangesDiffStyle,
  readChangesDiffStyle,
  readChangesWordWrap,
  writeChangesDiffStyle,
  writeChangesWordWrap,
} from "@/lib/threads/changes-view-prefs";
import { useWorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";
import { cn } from "@/lib/utils";
import { ChangesSummary, RevertAllButton, WorktreeChangesBody, useSectionCollapse } from "./worktree-changes-body";
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
  const params = useRouteParams<{ organizationSlug: string; projectAlias: string }>();
  const state = useWorktreeChanges(profileId, pathId);
  const [diffStyle, setDiffStyle] = useState<ChangesDiffStyle>(readChangesDiffStyle);
  const [wordWrap, setWordWrap] = useState(readChangesWordWrap);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const collapse = useSectionCollapse(allCollapsed);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMobile = useIsMobile();
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const diffOptions = usePatchDiffOptions(diffStyle, wordWrap);

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
  return (
    <ThreadWorkspaceSplitPane
      isSidebarOpen={sidebarOpen && hasFiles && !isMobile}
      onCloseSidebar={() => setSidebarOpen(false)}
      sidebarTitle="Files"
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
      {/* minmax(0,1fr) column: an auto column takes the longest diff line's width and overflows a phone viewport. */}
      <main className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
        <ThreadHeader
          title={title}
          leading={<ThreadMobileBackButton organizationSlug={params.organizationSlug} projectAlias={params.projectAlias} />}
          actions={
            entry && isOnline ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer gap-1.5 text-xs"
                  onClick={state.refresh}
                  disabled={changes.loading}
                  aria-label="Refresh changes"
                >
                  <RefreshCw className={cn("size-3.5", changes.loading && "animate-spin")} />
                  Refresh
                </Button>
                {hasFiles && !sidebarOpen && !isMobile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="cursor-pointer"
                    onClick={() => setSidebarOpen(true)}
                    aria-label="Show files"
                  >
                    <PanelRight className="size-4" />
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
        {/* ponytail: 41px like ThreadChangesToolbar — lines up with the sidebar's "New thread" row. */}
        {entry && (
          <div className="flex h-[41px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-xs text-muted-foreground">
            <span className="truncate font-mono" title={entry.path}>
              {entry.path}
            </span>
            <ChangesSummary files={files} />
            {isOnline && <RevertAllButton state={state} />}
            <div className="ml-auto flex items-center gap-1">
              <ChangesViewToggles
                allCollapsed={allCollapsed}
                onToggleCollapseAll={() => setAllCollapsed((value) => !value)}
                diffStyle={diffStyle}
                onToggleDiffStyle={toggleDiffStyle}
                wordWrap={wordWrap}
                onToggleWordWrap={toggleWordWrap}
              />
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-col">
          <FileTabStrip
            activeTab={state.activeTab}
            openPaths={state.openPaths}
            onSelect={state.selectTab}
            onClose={state.closeFileTab}
          />
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
        <RevertFileDialog state={state} />
        <RevertAllDialog state={state} />
      </main>
    </ThreadWorkspaceSplitPane>
  );
}
