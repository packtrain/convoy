"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { AtSign, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { PatchDiff, File as FileView, type DiffLineAnnotation } from "@pierre/diffs/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { Spinner } from "@/components/custom/spinner";
import type { CliRunDiffFile, CliRunDiffSummary } from "@/convex/lib/contracts/validators";
import {
  anchorsEqual,
  extractPatchExcerpt,
  type RunReviewComment,
  type RunReviewCommentAnchor,
} from "@/lib/threads/run-review-comments";
import { parseFileOpResult, parseRunPatchFiles, splitRunPatch, type FileOpResult } from "@/lib/threads/run-diff-patch";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { getErrorMessage } from "@/lib/errors";

/** Where run-file ops execute: the thread's profile + path entry. */
export interface RunFileOpContext {
  profileId: string;
  pathId: string;
  isProfileOnline: boolean;
}

type OpKind = "readFile" | "diffFile";

/** Active tab value for the changes view; file tabs use their path. */
const CHANGES_TAB = null;

// Checkpoint refs are immutable, so a fetched result never goes stale.
// ponytail: unbounded per-session map; results are ≤700 kB and users view
// a handful of files — add LRU eviction if memory ever matters.
const resultCache = new Map<string, FileOpResult>();

// The whole-run diff caches under filePath "".
// preRef is part of the key: a range and a run can end at the same postRef (OS-1883).
function cacheKey(preRef: string | undefined, postRef: string, filePath: string, kind: OpKind): string {
  return `${preRef ?? ""}:${postRef}:${filePath}:${kind}`;
}

/**
 * Enqueue-and-watch one worktree file op, resolving from the session cache
 * first. The completion path derives the cache key from the op row itself, so
 * a mid-flight tab switch can never mis-file a result.
 */
function useWorktreeFileOp(args: {
  context: RunFileOpContext;
  enabled: boolean;
  kind: OpKind;
  filePath?: string;
  preRef?: string;
  postRef: string;
}): { result: FileOpResult | undefined; error: string | null; retry: () => void } {
  const [opId, setOpId] = useState<Id<"cliWorktreeOps"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const op = useQuery(api.cli.worktreeOps.get, opId ? { opId } : "skip");

  const key = cacheKey(args.preRef, args.postRef, args.filePath ?? "", args.kind);
  const cached = resultCache.get(key);

  useEffect(() => {
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!op || op.status === "pending") {
      return;
    }
    setOpId(null);
    if (op.status === "failed") {
      setError(op.error ?? "Failed to load file");
      return;
    }
    const opKind: OpKind = op.kind === "readFile" ? "readFile" : "diffFile";
    const parsed = parseFileOpResult(op.resultJson, opKind === "diffFile" ? "patch" : "content");
    if (!parsed || !op.postRef) {
      setError("Received a malformed result");
      return;
    }
    resultCache.set(cacheKey(op.preRef, op.postRef, op.filePath ?? "", opKind), parsed);
  }, [op]);

  useEffect(() => {
    if (!args.enabled || cached || !args.context.isProfileOnline) {
      return;
    }
    let cancelled = false;
    enqueueOp({
      profileId: args.context.profileId as Id<"cliProfiles">,
      kind: args.kind,
      pathId: args.context.pathId,
      ...(args.filePath ? { filePath: args.filePath } : {}),
      ...(args.preRef ? { preRef: args.preRef } : {}),
      postRef: args.postRef,
    })
      .then((id) => {
        if (!cancelled) {
          setOpId(id);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError, "Failed to request file"));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, key, cached === undefined, args.context.isProfileOnline, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  return { result: cached, error, retry };
}

function PanelMessage({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <p className={destructive ? "p-4 text-sm text-destructive" : "p-4 text-sm text-muted-foreground"}>{children}</p>;
}

function FetchState({
  offline,
  error,
  onRetry,
}: {
  offline: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (offline) {
    return <PanelMessage>CLI offline. Connect it to fetch file contents.</PanelMessage>;
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={onRetry}>
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-4">
      <Spinner
        className="text-sm text-muted-foreground"
        shimmer
        text="Fetching from CLI…"
        textClassName="text-current"
        textPlacement="inline"
      />
    </div>
  );
}

function TruncationNote() {
  return (
    <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
      Output truncated — showing the first 700 kB.
    </p>
  );
}

/**
 * Stable review callbacks threaded into each diff section (OS-1155). Kept
 * separate from per-file data (comments, draft) so memoized sections only
 * re-render when THEIR file's review state changes — a line click must not
 * re-render every PatchDiff in the panel.
 */
interface ReviewActions {
  onOpenDraft: (anchor: RunReviewCommentAnchor) => void;
  onCancelDraft: () => void;
  onSaveComment: (anchor: RunReviewCommentAnchor, note: string) => void;
  onRemoveComment: (anchor: RunReviewCommentAnchor) => void;
}

const NO_COMMENTS: RunReviewComment[] = [];

/** Annotation payload: a saved comment row, or null for the open draft editor. */
interface ReviewAnnotationMetadata {
  comment: RunReviewComment | null;
}

function ReviewCommentEditor({
  initialNote,
  onSave,
  onCancel,
}: {
  initialNote: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(initialNote);
  const canSave = note.trim().length > 0;
  const save = () => {
    if (canSave) {
      onSave(note.trim());
    }
  };

  return (
    <InputGroup className="mx-3 my-2 w-auto bg-background font-sans shadow-sm">
      <InputGroupTextarea
        autoFocus
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Leave a comment for the agent..."
        className="min-h-16 text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <InputGroupAddon align="block-end" className="justify-end">
        <InputGroupButton className="cursor-pointer" onClick={onCancel}>
          Cancel
        </InputGroupButton>
        <InputGroupButton
          variant="default"
          className="cursor-pointer"
          disabled={!canSave}
          onClick={save}
        >
          Comment
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

function ReviewCommentRow({
  comment,
  onEdit,
  onRemove,
}: {
  comment: RunReviewComment;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    // Actions anchor to the note's FIRST line: the 32px buttons get -my-1.5
    // so their center matches the 20px line without stretching single-line
    // rows.
    <div className="mx-3 my-2 flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 font-sans shadow-sm">
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{comment.note}</p>
      <span className="-my-1.5 flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Edit comment"
          className="cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={onEdit}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete comment"
          className="cursor-pointer text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </span>
    </div>
  );
}

/**
 * One collapsible per-file section of the run diff. Memoized: with dozens of
 * sections, panel-level state changes (opening a comment draft) must only
 * re-render the affected file, not every PatchDiff.
 */
const RunDiffFileSection = memo(function RunDiffFileSection({
  file,
  patch,
  runTruncated,
  collapsed,
  diffStyle,
  wrapLines,
  onToggle,
  onOpenFile,
  onMentionFile,
  onRevertFile,
  registerSection,
  fileComments,
  draft,
  reviewActions,
}: {
  file: CliRunDiffFile;
  patch: string | undefined;
  runTruncated: boolean;
  collapsed: boolean;
  diffStyle: "unified" | "split";
  wrapLines: boolean;
  onToggle: (path: string) => void;
  onOpenFile?: (path: string) => void;
  /** Header action: insert an `@path` mention into the composer (OS-1159). */
  onMentionFile?: (path: string) => void;
  /** Header action: revert this one file to its pre-run state (OS-1156). */
  onRevertFile?: (file: CliRunDiffFile) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  /** This file's saved comments (NO_COMMENTS when review is disabled). */
  fileComments: RunReviewComment[];
  /** The open draft anchor when it belongs to this file. */
  draft: RunReviewCommentAnchor | null;
  reviewActions?: ReviewActions;
}) {
  const path = file.path;
  const baseOptions = usePatchDiffOptions(diffStyle, wrapLines);

  const annotations = useMemo<DiffLineAnnotation<ReviewAnnotationMetadata>[]>(
    () => [
      ...fileComments.map((comment) => ({
        side: comment.side,
        lineNumber: comment.lineNumber,
        metadata: { comment } as ReviewAnnotationMetadata,
      })),
      // A draft on a fresh line needs its own annotation row; a draft editing
      // an existing comment renders inside that comment's annotation instead.
      ...(draft && !fileComments.some((comment) => anchorsEqual(comment, draft))
        ? [{ side: draft.side, lineNumber: draft.lineNumber, metadata: { comment: null } }]
        : []),
    ],
    [fileComments, draft]
  );

  // Stable across draft/comment changes so PatchDiff never sees new options.
  const diffOptions = useMemo(
    () => ({
      ...baseOptions,
      ...(reviewActions
        ? {
            lineHoverHighlight: "line" as const,
            onLineClick: ({ lineNumber, annotationSide }: { lineNumber: number; annotationSide: "additions" | "deletions" }) =>
              reviewActions.onOpenDraft({ path, side: annotationSide, lineNumber }),
          }
        : {}),
    }),
    [reviewActions, path, baseOptions]
  );

  const renderAnnotation = useMemo(() => {
    if (!reviewActions) {
      return undefined;
    }
    return function RenderReviewAnnotation(annotation: DiffLineAnnotation<ReviewAnnotationMetadata>) {
      const anchor: RunReviewCommentAnchor = {
        path,
        side: annotation.side,
        lineNumber: annotation.lineNumber,
      };
      const comment = annotation.metadata.comment;
      if (draft && anchorsEqual(draft, anchor)) {
        return (
          <ReviewCommentEditor
            initialNote={comment?.note ?? ""}
            onSave={(note) => reviewActions.onSaveComment(anchor, note)}
            onCancel={reviewActions.onCancelDraft}
          />
        );
      }
      if (comment) {
        return (
          <ReviewCommentRow
            comment={comment}
            onEdit={() => reviewActions.onOpenDraft(anchor)}
            onRemove={() => reviewActions.onRemoveComment(anchor)}
          />
        );
      }
      return null;
    };
  }, [reviewActions, draft, path]);

  return (
    <PatchFileSection
      file={file}
      patch={patch}
      collapsed={collapsed}
      onToggle={onToggle}
      registerSection={registerSection}
      actions={
        <>
          {onMentionFile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              aria-label={`Mention ${file.path} in reply`}
              title="Mention in reply"
              onClick={() => onMentionFile(file.path)}
            >
              <AtSign className="size-3.5" />
            </Button>
          )}
          {onRevertFile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              aria-label={`Revert ${file.path}`}
              title="Revert file"
              onClick={() => onRevertFile(file)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          {onOpenFile && file.kind !== "deleted" && !file.binary && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 cursor-pointer px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onOpenFile(path)}
            >
              Open file
            </Button>
          )}
        </>
      }
    >
      {patch ? (
        <PatchDiff<ReviewAnnotationMetadata>
          patch={patch}
          options={diffOptions}
          lineAnnotations={reviewActions ? annotations : undefined}
          renderAnnotation={renderAnnotation}
        />
      ) : (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          {runTruncated ? "Patch not available (run diff truncated)." : "No changes in the run diff for this file."}
        </p>
      )}
    </PatchFileSection>
  );
});

/** This run's review-comment slice, owned by the thread page (OS-1155). */
export interface RunFileViewerReview {
  comments: RunReviewComment[];
  upsertComment: (anchor: RunReviewCommentAnchor, note: string, excerpt?: string) => void;
  removeComment: (anchor: RunReviewCommentAnchor) => void;
}

export interface RunFileViewerPanelProps {
  /** File row the user clicked; the changes list scrolls to it. */
  selectedPath?: string;
  diffSummary: CliRunDiffSummary;
  /**
   * Derive the file list from the fetched patch instead of
   * `diffSummary.files` — for ref ranges with no stored summary (the
   * cumulative "All changes" view, OS-1158).
   */
  deriveFilesFromPatch?: boolean;
  /** Label of the changes tab (default "Changes"). */
  changesTabLabel?: string;
  /** Base collapse state for all file sections (toolbar collapse-all toggle). */
  allCollapsed?: boolean;
  /** Diff rendering mode for file sections (default "unified"). */
  diffStyle?: "unified" | "split";
  /** Wraps long lines instead of horizontal scrolling (default false). */
  wrapLines?: boolean;
  fileTreeOpen?: boolean;
  context: RunFileOpContext;
  /** Enables the inline line-comment UI; comments surface as a composer pill. */
  review?: RunFileViewerReview;
  /** Section-header action: insert an `@path` mention into the composer (OS-1159). */
  onMentionFile?: (path: string) => void;
  /** Section-header action: revert one file to its pre-run state (OS-1156). */
  onRevertFile?: (file: CliRunDiffFile) => void;
}

/**
 * Run-diff viewer for the Changes card (OS-1143), hosted in the thread workspace
 * sidebar. The Changes tab shows the whole run patch as collapsible per-file sections
 * (scrolled to the clicked file); "Open file" adds a full-file tab. Content is fetched
 * live from the connected CLI and never stored in Convex.
 */
export function RunFileViewerPanel({
  selectedPath,
  diffSummary,
  deriveFilesFromPatch = false,
  changesTabLabel = "Changes",
  allCollapsed = false,
  diffStyle = "unified",
  wrapLines = false,
  fileTreeOpen = false,
  context,
  review,
  onMentionFile,
  onRevertFile,
}: RunFileViewerPanelProps) {
  const diffTheme = useDiffTheme();
  const changesContainerRef = useRef<HTMLDivElement>(null);
  const { width: fileTreeWidth, handleMouseDown, adjustWidthBy } = useResizePanel(
    changesContainerRef,
    { bounds: THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS }
  );
  const [activeTab, setActiveTab] = useState<string | null>(CHANGES_TAB);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  // Collapse state is XOR over the `allCollapsed` base: a path in the set is
  // flipped from the base, so collapse-all works before the patch (and its
  // file list) has loaded. Per-file toggles reset when the base flips.
  const [collapseToggledPaths, setCollapseToggledPaths] = useState<ReadonlySet<string>>(new Set());
  const [lastAllCollapsed, setLastAllCollapsed] = useState(allCollapsed);
  if (lastAllCollapsed !== allCollapsed) {
    setLastAllCollapsed(allCollapsed);
    setCollapseToggledPaths(new Set());
  }
  const [treeSelection, setTreeSelection] = useState<{ path: string }>();
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  // Inline review comments on diff lines (OS-1155); the comment store lives
  // on the thread page, this panel only edits this run's slice.
  const [draftAnchor, setDraftAnchor] = useState<RunReviewCommentAnchor | null>(null);

  // A new row click re-focuses the changes tab (render-phase prop-derived
  // state adjustment; the scroll effect below handles the scrolling).
  const [lastSelectedPath, setLastSelectedPath] = useState(selectedPath);
  if (lastSelectedPath !== selectedPath) {
    setLastSelectedPath(selectedPath);
    setTreeSelection(undefined);
    setActiveTab(CHANGES_TAB);
  }

  const runDiff = useWorktreeFileOp({
    context,
    enabled: true,
    kind: "diffFile",
    preRef: diffSummary.preRef,
    postRef: diffSummary.postRef,
  });
  // Deferred so React renders the heavy diff tree concurrently: the spinner
  // paints first and the UI stays responsive instead of freezing for the
  // whole parse+highlight render when a large patch lands.
  const runDiffResult = useDeferredValue(runDiff.result);
  const activeFilePath = activeTab ?? undefined;
  const fileView = useWorktreeFileOp({
    context,
    enabled: activeFilePath !== undefined,
    kind: "readFile",
    filePath: activeFilePath,
    postRef: diffSummary.postRef,
  });

  const patchByPath = useMemo(
    () => (runDiffResult ? splitRunPatch(runDiffResult.text) : new Map<string, string>()),
    [runDiffResult]
  );
  const files = useMemo(
    () => (deriveFilesFromPatch ? parseRunPatchFiles(patchByPath) : diffSummary.files),
    [deriveFilesFromPatch, patchByPath, diffSummary.files]
  );

  const upsertReviewComment = review?.upsertComment;
  const removeReviewComment = review?.removeComment;
  const handleSaveComment = useCallback(
    (anchor: RunReviewCommentAnchor, note: string) => {
      // Capture the excerpt now — composing at send time then needs no patch.
      const patch = patchByPath.get(anchor.path);
      const excerpt = patch
        ? (extractPatchExcerpt(patch, anchor.side, anchor.lineNumber) ?? undefined)
        : undefined;
      upsertReviewComment?.(anchor, note, excerpt);
      setDraftAnchor(null);
    },
    [patchByPath, upsertReviewComment]
  );
  const handleRemoveComment = useCallback(
    (anchor: RunReviewCommentAnchor) => {
      removeReviewComment?.(anchor);
      setDraftAnchor((current) => (current && anchorsEqual(current, anchor) ? null : current));
    },
    [removeReviewComment]
  );
  const handleCancelDraft = useCallback(() => setDraftAnchor(null), []);
  const reviewEnabled = review !== undefined;
  const reviewActions = useMemo<ReviewActions | undefined>(
    () =>
      reviewEnabled
        ? {
            onOpenDraft: setDraftAnchor,
            onCancelDraft: handleCancelDraft,
            onSaveComment: handleSaveComment,
            onRemoveComment: handleRemoveComment,
          }
        : undefined,
    [reviewEnabled, handleCancelDraft, handleSaveComment, handleRemoveComment]
  );
  const commentsByPath = useMemo(() => {
    const byPath = new Map<string, RunReviewComment[]>();
    for (const comment of review?.comments ?? []) {
      const list = byPath.get(comment.path);
      if (list) {
        list.push(comment);
      } else {
        byPath.set(comment.path, [comment]);
      }
    }
    return byPath;
  }, [review?.comments]);

  // Scroll the changes list to the clicked file once its section exists.
  const hasRunDiff = runDiffResult !== undefined;
  const scrollPath = treeSelection?.path ?? selectedPath;
  useEffect(() => {
    if (activeTab !== CHANGES_TAB || !hasRunDiff || scrollPath === undefined) {
      return;
    }
    sectionRefs.current.get(scrollPath)?.scrollIntoView({ block: "start" });
  }, [scrollPath, treeSelection, hasRunDiff, activeTab]);

  const openFileTab = useCallback((path: string) => {
    setOpenFilePaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
    setActiveTab(path);
  }, []);
  const closeFileTab = (path: string) => {
    setOpenFilePaths((paths) => paths.filter((openPath) => openPath !== path));
    setActiveTab((current) => (current === path ? CHANGES_TAB : current));
  };
  const toggleCollapsed = useCallback((path: string) => {
    setCollapseToggledPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) {
      sectionRefs.current.set(path, element);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileTabStrip
        activeTab={activeTab}
        openPaths={openFilePaths}
        changesLabel={changesTabLabel}
        onSelect={setActiveTab}
        onClose={closeFileTab}
      />
      <div ref={changesContainerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {activeTab === CHANGES_TAB ? (
            runDiffResult ? (
              <>
                {runDiffResult.truncated && <TruncationNote />}
                {files.length === 0 && (
                  <PanelMessage>No changes between these checkpoints.</PanelMessage>
                )}
                {files.map((file) => (
                  <RunDiffFileSection
                    key={file.path}
                    file={file}
                    patch={patchByPath.get(file.path)}
                    runTruncated={runDiffResult?.truncated === true}
                    collapsed={allCollapsed !== collapseToggledPaths.has(file.path)}
                    diffStyle={diffStyle}
                    wrapLines={wrapLines}
                    onToggle={toggleCollapsed}
                    onOpenFile={openFileTab}
                    onMentionFile={onMentionFile}
                    onRevertFile={onRevertFile}
                    fileComments={commentsByPath.get(file.path) ?? NO_COMMENTS}
                    draft={draftAnchor?.path === file.path ? draftAnchor : null}
                    reviewActions={reviewActions}
                    registerSection={registerSection}
                  />
                ))}
              </>
            ) : (
              <FetchState
                offline={!context.isProfileOnline}
                onRetry={runDiff.retry}
                // A pruned checkpoint ref fails `git diff` with a raw "bad
                // revision" — translate it (checkpoints keep ~20 runs).
                error={
                  runDiff.error && /bad revision|bad object|unknown revision/i.test(runDiff.error)
                    ? "A checkpoint for this range no longer exists — it was likely pruned (only recent runs keep checkpoints)."
                    : runDiff.error
                }
              />
            )
          ) : fileView.result ? (
            <>
              {fileView.result.truncated && <TruncationNote />}
              {fileView.result.text.length === 0 ? (
                <PanelMessage>This file is empty.</PanelMessage>
              ) : (
                <FileView
                  file={{ name: activeTab, contents: fileView.result.text }}
                  options={{
                    ...diffTheme,
                    disableFileHeader: true,
                    overflow: wrapLines ? "wrap" : "scroll",
                  }}
                />
              )}
            </>
          ) : (
            <FetchState offline={!context.isProfileOnline} error={fileView.error} onRetry={fileView.retry} />
          )}
        </div>
        {fileTreeOpen && runDiffResult && files.length > 0 && (
          <div className="relative max-w-[60%] shrink-0" style={{ width: fileTreeWidth }}>
            <SidebarResizeHandle
              ariaLabel="Resize file tree"
              currentWidth={fileTreeWidth}
              bounds={THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS}
              expandDirection="left"
              onResizeMouseDown={handleMouseDown}
              onResizeByStep={adjustWidthBy}
              className="absolute inset-y-0 left-0 z-20 -translate-x-1/2"
            />
            <aside aria-label="Changed files" className="h-full overflow-auto border-l border-border">
              <WorktreeFileTree
                files={files}
                selectedPath={activeTab ?? scrollPath}
                onSelectFile={(path) => {
                  setActiveTab(CHANGES_TAB);
                  setTreeSelection({ path });
                  setCollapseToggledPaths((current) => {
                    const next = new Set(current);
                    if (allCollapsed) next.add(path);
                    else next.delete(path);
                    return next;
                  });
                }}
                onOpenFile={openFileTab}
                onRevertFile={onRevertFile}
              />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
