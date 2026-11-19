"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { File as FileView } from "@pierre/diffs/react";
import { ArrowUpRight, PanelRight, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { getErrorMessage } from "@/lib/errors";
import { toSectionFile, type PullRequestDiff, type PullRequestDiffFile } from "./github-patch";
import { PullRequestFileSection } from "./pull-request-file-section";
import { fileLineComments, toLineEditor, type LineEditor, type PullRequestReview } from "./pull-request-review";
import type { PullRequestOverview } from "./types";
import type { useReviewedMarks } from "./use-reviewed-marks";

type FileState =
  | { kind: "loading" }
  | { kind: "text"; contents: string }
  | { kind: "binary" }
  | { kind: "tooLarge" }
  | { kind: "error"; message: string };

/** The Diff tab: files as collapsible sections with Reviewed marks, a closable file tree, and whole files in tabs. */
export function PullRequestChanges({
  diff,
  projectId,
  repositoryId,
  number,
  marks,
  review,
  reviewComments,
  reveal,
}: {
  diff: PullRequestDiff;
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  marks: ReturnType<typeof useReviewedMarks>;
  review: PullRequestReview;
  /** GitHub's inline comments at the diff's revision; empty until the Overview loads. */
  reviewComments: PullRequestOverview["reviewComments"];
  /** A pending comment to scroll to; each jump is a new object. */
  reveal: { path: string; id: string } | null;
}) {
  const readFile = useAction(api.integrations.github.pullRequests.readFile);
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [wordWrap, setWordWrap] = useState(true);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string>();
  const [treeOpen, setTreeOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [contents, setContents] = useState<ReadonlyMap<string, FileState>>(new Map());
  const isMobile = useIsMobile();
  // One line editor at a time across the files.
  const [editor, setEditor] = useState<LineEditor | null>(null);
  const openEditor = useCallback(
    (path: string, range: Parameters<typeof toLineEditor>[1] | null) =>
      setEditor((current) => (range ? toLineEditor(path, range) : current?.path === path ? null : current)),
    []
  );
  const options = usePatchDiffOptions(diffStyle, wordWrap);
  const sections = useRef(new Map<string, HTMLElement>());
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) sections.current.set(path, element);
    else sections.current.delete(path);
  }, []);
  const summaries = useMemo(() => diff.files.map(toSectionFile), [diff.files]);
  const totals = diff.files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), {
    additions: 0,
    deletions: 0,
  });
  const reviewedCount = diff.files.filter(marks.isReviewed).length;
  const scroller = useRef<HTMLDivElement>(null);

  const isCollapsed = (path: string) => allCollapsed !== toggled.has(path);
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  // Reviewing folds the file and un-reviewing unfolds it, as on GitHub.
  const setReviewed = (file: PullRequestDiffFile, reviewed: boolean) => {
    marks.setReviewed(file, reviewed);
    if (isCollapsed(file.path) !== reviewed) toggle(file.path);
  };

  const openFile = (file: PullRequestDiffFile) => {
    setOpenPaths((current) => (current.includes(file.path) ? current : [...current, file.path]));
    setActiveTab(file.path);
    if (contents.has(file.path)) return;
    const set = (state: FileState) => setContents((current) => new Map(current).set(file.path, state));
    set({ kind: "loading" });
    // A deleted file only exists before the change.
    const ref = file.status === "removed" ? diff.baseSha : diff.headSha;
    readFile({ projectId, repositoryId, number, path: file.path, ref })
      .then(set)
      .catch((error: unknown) => set({ kind: "error", message: getErrorMessage(error, "Could not load the file") }));
  };
  const activeFile = diff.files.find((file) => file.path === activeTab);

  // A jump shows the diff with the comment's file unfolded, then scrolls to the comment once it renders.
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal) {
      setActiveTab(null);
      if (isCollapsed(reveal.path)) toggle(reveal.path);
    }
  }
  useEffect(() => {
    if (!reveal) return;
    const frame = requestAnimationFrame(() =>
      scroller.current?.querySelector(`[data-pending-comment="${reveal.id}"]`)?.scrollIntoView({ block: "center" })
    );
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  return (
    <ThreadWorkspaceSplitPane
      isSidebarOpen={treeOpen && !isMobile}
      onCloseSidebar={() => setTreeOpen(false)}
      sidebarTitle="Files"
      sidebarHeader={
        <div className="flex h-[41px] items-center justify-between border-b px-3 text-xs font-medium">
          Files
          <Button variant="ghost" size="icon-sm" aria-label="Close files" onClick={() => setTreeOpen(false)}>
            <X />
          </Button>
        </div>
      }
      sidebarContent={
        <WorktreeFileTree
          files={summaries}
          selectedPath={selectedPath}
          onSelectFile={(path) => {
            setSelectedPath(path);
            setActiveTab(null);
            if (isCollapsed(path)) toggle(path);
            requestAnimationFrame(() => sections.current.get(path)?.scrollIntoView({ block: "start" }));
          }}
          onOpenFile={(path) => {
            const file = diff.files.find((candidate) => candidate.path === path);
            if (file) openFile(file);
          }}
        />
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[41px] shrink-0 items-center gap-3 border-b bg-card px-4 text-xs text-muted-foreground tabular-nums">
          <span>
            {diff.changedFiles} {diff.changedFiles === 1 ? "file" : "files"}
          </span>
          <span className="text-success">+{totals.additions}</span>
          <span className="text-destructive">-{totals.deletions}</span>
          <span>
            · {reviewedCount} / {diff.files.length} reviewed
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ChangesViewToggles
              allCollapsed={allCollapsed}
              onToggleCollapseAll={() => {
                setAllCollapsed(!allCollapsed);
                setToggled(new Set());
              }}
              diffStyle={diffStyle}
              onToggleDiffStyle={() => setDiffStyle(diffStyle === "unified" ? "split" : "unified")}
              wordWrap={wordWrap}
              onToggleWordWrap={() => setWordWrap(!wordWrap)}
            />
            {!treeOpen && !isMobile ? (
              <Button variant="ghost" size="icon-sm" aria-label="Show files" onClick={() => setTreeOpen(true)}>
                <PanelRight />
              </Button>
            ) : null}
          </div>
        </div>
        <FileTabStrip
          activeTab={activeTab}
          openPaths={openPaths}
          onSelect={setActiveTab}
          onClose={(path) => {
            setOpenPaths((current) => current.filter((item) => item !== path));
            if (activeTab === path) setActiveTab(null);
          }}
        />
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          {diff.partial ? (
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">
              Some changes aren&apos;t shown here.{" "}
              <a href={`${diff.htmlUrl}/files`} target="_blank" rel="noreferrer" className="underline">
                See every file on GitHub
              </a>
            </p>
          ) : null}
          {activeFile ? (
            <WholeFile file={activeFile} state={contents.get(activeFile.path)} options={options} htmlUrl={diff.htmlUrl} />
          ) : (
            diff.files.map((file) => (
              <PullRequestFileSection
                key={file.path}
                file={file}
                htmlUrl={diff.htmlUrl}
                options={options}
                collapsed={isCollapsed(file.path)}
                onToggle={toggle}
                registerSection={registerSection}
                reviewed={marks.isReviewed(file)}
                onReviewedChange={(reviewed) => setReviewed(file, reviewed)}
                onOpen={() => openFile(file)}
                lineComments={{
                  ...fileLineComments({ path: file.path, posted: reviewComments, review, editor, onEditorChange: setEditor }),
                  onComment: review.blocker ? undefined : openEditor,
                }}
              />
            ))
          )}
        </div>
      </div>
    </ThreadWorkspaceSplitPane>
  );
}

function WholeFile({
  file,
  state,
  options,
  htmlUrl,
}: {
  file: PullRequestDiffFile;
  state: FileState | undefined;
  options: ReturnType<typeof usePatchDiffOptions>;
  htmlUrl: string;
}) {
  if (!state || state.kind === "loading") {
    return (
      <div className="space-y-3 p-5" aria-label="Loading file">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (state.kind === "text") {
    return <FileView file={{ name: file.path, contents: state.contents }} options={options} />;
  }
  const message = { binary: "This is a binary file.", tooLarge: "This file is too large to display.", error: state.kind === "error" ? state.message : "" }[
    state.kind
  ];
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
      <p>{message}</p>
      <Button variant="outline" size="sm" asChild>
        <a href={`${htmlUrl}/files`} target="_blank" rel="noreferrer">
          View on GitHub
          <ArrowUpRight />
        </a>
      </Button>
    </div>
  );
}

// Line widths per placeholder file, so sections differ the way real files do.
const SKELETON_FILES = [
  { path: "w-28", lines: ["w-2/3", "w-1/2"] },
  { path: "w-36", lines: ["w-1/2", "w-3/5", "w-2/3", "w-0", "w-1/4", "w-2/5"] },
  { path: "w-24", lines: ["w-1/2", "w-2/5", "w-3/5"] },
];

/** The Diff tab's outline while the diff loads: summary toolbar, file sections, and the Files pane. */
export function PullRequestChangesSkeleton() {
  const isMobile = useIsMobile();
  return (
    <ThreadWorkspaceSplitPane
      isSidebarOpen={!isMobile}
      onCloseSidebar={() => {}}
      sidebarTitle="Files"
      sidebarHeader={<div className="flex h-[41px] items-center border-b px-3 text-xs font-medium">Files</div>}
      sidebarContent={
        <ul aria-label="Loading files" className="py-1">
          {SKELETON_FILES.map((file, index) => (
            <li key={index} className="flex h-7 items-center gap-1.5 pr-3 pl-3">
              <Skeleton className="size-4" />
              <Skeleton className={`h-3.5 ${file.path}`} />
              <Skeleton className="ml-auto h-3 w-10" />
            </li>
          ))}
        </ul>
      }
    >
      <div aria-label="Loading changes" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div data-slot="changes-toolbar" className="flex h-[41px] shrink-0 items-center gap-3 border-b bg-card px-4">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-24" />
          <div className="ml-auto flex items-center gap-1">
            <Skeleton className="size-6" />
            <Skeleton className="size-6" />
            <Skeleton className="size-6" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {SKELETON_FILES.map((file, index) => (
            <section key={index}>
              <div className="flex h-[37px] items-center gap-1.5 border-b px-2">
                <Skeleton className="size-3.5" />
                <Skeleton className={`h-3 ${file.path}`} />
                <Skeleton className="ml-auto h-3 w-10" />
                <Skeleton className="ml-2 h-3.5 w-20" />
                <Skeleton className="size-6" />
              </div>
              <div className="py-2">
                {file.lines.map((width, line) => (
                  <div key={line} className="flex h-5 items-center gap-4 px-4">
                    <Skeleton className="h-3 w-3" />
                    {width === "w-0" ? null : <Skeleton className={`h-3 ${width}`} />}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </ThreadWorkspaceSplitPane>
  );
}
