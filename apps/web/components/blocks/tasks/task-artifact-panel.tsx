"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  FileText,
  FoldHorizontal,
  Maximize2,
  MessageSquarePlus,
  MessageSquareText,
  Minimize2,
  UnfoldHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ArtifactEditorSkeleton, TaskArtifactPanelSkeleton } from "@/components/blocks/tasks/task-artifact-panel-skeleton";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import { HtmlArtifactFrame } from "@/components/blocks/tasks/html-artifact-frame";
import {
  ArtifactCommentsRail,
  type CommentSort,
  type PendingArtifactComment,
} from "@/components/blocks/tasks/artifact-comments/artifact-comments-rail";
import {
  readCommentPrefs,
  writeCommentPrefs,
} from "@/components/blocks/tasks/artifact-comments/lib/comment-prefs";
import { CommentOverlay } from "@/components/blocks/tasks/artifact-comments/comment-overlay";
import { SendCommentsToThreadMenu } from "@/components/blocks/tasks/artifact-comments/send-comments-to-thread-menu";
import {
  composeArtifactCommentsMessage,
  filterOpenCommentThreads,
} from "@/lib/threads/artifact-comments-handoff";
import {
  captureSelection,
  caretOffset,
  getEditable,
  rangeForOffsets,
  textOf,
} from "@/components/blocks/tasks/artifact-comments/lib/dom-anchor";
import {
  locateAnchor,
  locateAnchorLines,
  type CommentAnchor,
} from "@/components/blocks/tasks/artifact-comments/lib/locate-anchor";
import { useArtifactComments } from "@/lib/tasks/hooks/comments/use-artifact-comments";
import { AppLink, appRoute, href, useRouteParams, type RouteTarget } from "@/lib/navigation";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { ARTIFACT_COMMENTS_RESIZE_BOUNDS } from "@/lib/tasks/constants";
import { useTaskArtifact } from "@/lib/tasks/hooks/use-task-artifacts";
import {
  UNTITLED_ARTIFACT_NAME,
  useArtifactAutosave,
} from "@/lib/tasks/hooks/detail/use-artifact-autosave";
import { downloadArtifact } from "@/lib/tasks/download-artifact";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

// Editor content defaults to a narrow readable measure; the header toggle
// switches to full width and the choice persists across artifacts/sessions.
const FULL_WIDTH_STORAGE_KEY = "task-artifact-full-width";

function readStoredFullWidth() {
  return readLocalString(FULL_WIDTH_STORAGE_KEY) === "true";
}

const MdxEditor = dynamic(
  () => import("@/components/mdx-editor").then((mod) => mod.MdxEditor),
  {
    ssr: false,
    loading: () => <ArtifactEditorSkeleton />,
  }
);

interface TaskArtifactPanelProps {
  selectedArtifactId: string;
  widthCss?: string;
  // Narrow hosts (thread sidebar): fill the container instead of requesting a
  // fixed width, and float the comments rail over the editor instead of
  // docking it as a column.
  compact?: boolean;
  // Full-page route host: fill the container, never wrap in a drawer, and swap
  // the header's "Open full page" action for a back-to-task link (no close X).
  fullPage?: boolean;
  backTarget?: RouteTarget;
  onClose: () => void;
  onInvalidSelection: () => void;
  onUpdateArtifact: (args: {
    artifactId: Id<"taskArtifacts">;
    name?: string;
    content?: string;
  }) => Promise<void>;
  disabled?: boolean;
  // Task context for the send-comments-to-thread action; the menu is hidden
  // when any of these are missing.
  projectId?: Id<"projects">;
  taskId?: Id<"tasks">;
  taskRefId?: string;
  /** Host-owned thread switch for the send action (thread workspace, OS-1716). */
  onNavigateToThread?: (threadId: Id<"cliThreads">) => void;
}

export function TaskArtifactPanel({
  selectedArtifactId,
  widthCss,
  compact = false,
  fullPage = false,
  backTarget,
  onClose,
  onInvalidSelection,
  onUpdateArtifact,
  disabled = false,
  projectId,
  taskId,
  taskRefId,
  onNavigateToThread,
}: TaskArtifactPanelProps) {
  const artifact = useTaskArtifact(selectedArtifactId);
  const isMobile = useIsMobile();
  // Hosts that lay the panel out themselves never get the mobile drawer: the
  // full-page route is its own viewport, and a compact host (thread sidebar) is
  // already a drawer on mobile — nesting one inside it traps the user.
  const useDrawer = isMobile && !fullPage && !compact;

  useEffect(() => {
    if (artifact === null) {
      onInvalidSelection();
    }
  }, [artifact, onInvalidSelection]);

  if (!artifact) {
    const loadingContent = (
      <ArtifactPanelFrame widthCss={widthCss} isMobile={isMobile} compact={compact} fullPage={fullPage}>
        <TaskArtifactPanelSkeleton />
      </ArtifactPanelFrame>
    );

    if (!useDrawer) {
      return loadingContent;
    }

    return (
      <ArtifactPanelDrawer onClose={onClose}>{loadingContent}</ArtifactPanelDrawer>
    );
  }

  const panelContent = (
    <TaskArtifactPanelContent
      key={artifact._id}
      artifact={artifact}
      widthCss={widthCss}
      compact={compact}
      fullPage={fullPage}
      backTarget={backTarget}
      isMobile={isMobile}
      onClose={onClose}
      onUpdateArtifact={onUpdateArtifact}
      disabled={disabled}
      projectId={projectId}
      taskId={taskId}
      taskRefId={taskRefId}
      onNavigateToThread={onNavigateToThread}
    />
  );

  if (!useDrawer) {
    return panelContent;
  }

  return (
    <ArtifactPanelDrawer onClose={onClose}>{panelContent}</ArtifactPanelDrawer>
  );
}

function TaskArtifactPanelContent({
  artifact,
  widthCss,
  compact,
  fullPage,
  backTarget,
  isMobile,
  onClose,
  onUpdateArtifact,
  disabled,
  projectId,
  taskId,
  taskRefId,
  onNavigateToThread,
}: {
  artifact: NonNullable<ReturnType<typeof useTaskArtifact>>;
  widthCss?: string;
  compact: boolean;
  fullPage: boolean;
  backTarget?: RouteTarget;
  isMobile: boolean;
  onClose: () => void;
  onUpdateArtifact: (args: {
    artifactId: Id<"taskArtifacts">;
    name?: string;
    content?: string;
  }) => Promise<void>;
  disabled: boolean;
  projectId?: Id<"projects">;
  taskId?: Id<"tasks">;
  taskRefId?: string;
  onNavigateToThread?: (threadId: Id<"cliThreads">) => void;
}) {
  const params = useRouteParams<{ organizationSlug?: string; projectAlias?: string }>();
  const artifactContentType = artifact.contentType ?? "markdown";
  const isHtml = artifactContentType === "html";
  const fullPageHref =
    params.organizationSlug && params.projectAlias
      ? href(appRoute.projectArtifact(params.organizationSlug, params.projectAlias, artifact._id))
      : null;
  const {
    nameInputValue,
    setNameInputValue,
    content,
    setContent,
    saveState,
    saveStatusText,
  } = useArtifactAutosave({ artifact, onUpdateArtifact, disabled });
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);

  const [isFullWidth, setIsFullWidth] = useState(readStoredFullWidth);
  const toggleFullWidth = () => {
    const next = !isFullWidth;
    setIsFullWidth(next);
    // Storage may be unavailable (private mode) — the choice just won't persist.
    writeLocalString(FULL_WIDTH_STORAGE_KEY, String(next));
  };

  const handleDownload = () => {
    const success = downloadArtifact(content, artifact.fileName, artifactContentType);
    if (!success) {
      toast.error("Could not download artifact");
    }
  };

  // --- Artifact comments (markdown artifacts only; see docs/specs/artifact-comments.md)
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  const commentsResize = useResizePanel(commentsContainerRef, {
    bounds: ARTIFACT_COMMENTS_RESIZE_BOUNDS,
  });
  const {
    threads,
    createComment,
    createReply,
    updateComment,
    deleteComment,
    setStatus,
  } = useArtifactComments(isHtml ? null : artifact._id);
  const [isCommentsOpen, setIsCommentsOpen] = useState(
    () => readCommentPrefs().isOpen
  );
  const setCommentsOpen = useCallback((open: boolean) => {
    setIsCommentsOpen(open);
    writeCommentPrefs({ isOpen: open });
  }, []);
  const [showResolved, setShowResolvedState] = useState(
    () => readCommentPrefs().showResolved
  );
  const [activeCommentId, setActiveCommentId] = useState<Id<"artifactComments"> | null>(null);
  const [detachedIds, setDetachedIds] = useState<ReadonlySet<string>>(new Set());
  const [anchorPositions, setAnchorPositions] = useState<ReadonlyMap<string, number>>(
    new Map()
  );
  const [commentSort, setCommentSortState] = useState<CommentSort>(
    () => readCommentPrefs().sort
  );
  const [pendingComment, setPendingComment] = useState<PendingArtifactComment | null>(null);

  const setShowResolved = useCallback(
    (show: boolean) => {
      setShowResolvedState(show);
      writeCommentPrefs({ showResolved: show, sort: commentSort });
    },
    [commentSort]
  );
  const setCommentSort = useCallback(
    (sort: CommentSort) => {
      setCommentSortState(sort);
      writeCommentPrefs({ showResolved, sort });
    },
    [showResolved]
  );
  const [selectionButton, setSelectionButton] = useState<{
    anchor: CommentAnchor;
    top: number;
    left: number;
  } | null>(null);

  const visibleThreads = useMemo(
    () => (showResolved ? threads : threads.filter((t) => t.root.status !== "resolved")),
    [threads, showResolved]
  );

  const openThreads = useMemo(() => filterOpenCommentThreads(threads), [threads]);
  // Enrich anchors with their line range in the markdown source so the
  // handoff message can point the agent at the right lines; anchors capture
  // rendered text, so unlocatable (formatted/detached) snippets just omit it.
  const handoffThreads = useMemo(
    () =>
      openThreads.map((t) =>
        t.root.anchor
          ? {
              ...t,
              root: {
                ...t.root,
                anchor: {
                  ...t.root.anchor,
                  lines: locateAnchorLines(content, t.root.anchor) ?? undefined,
                },
              },
            }
          : t
      ),
    [openThreads, content]
  );
  const sendToThreadAction =
    !disabled &&
    openThreads.length > 0 &&
    projectId &&
    taskId &&
    taskRefId &&
    params.organizationSlug &&
    params.projectAlias ? (
      <SendCommentsToThreadMenu
        projectId={projectId}
        taskId={taskId}
        taskRefId={taskRefId}
        organizationSlug={params.organizationSlug}
        projectAlias={params.projectAlias}
        artifactId={artifact._id}
        message={composeArtifactCommentsMessage({
          artifactName: artifact.name,
          artifactId: artifact._id,
          threads: handoffThreads,
        })}
        onNavigateToThread={onNavigateToThread}
      />
    ) : undefined;

  const overlayComments = useMemo(
    () =>
      visibleThreads
        .filter((t) => t.root.anchor)
        .map((t) => ({
          id: t.root._id as string,
          anchor: t.root.anchor as CommentAnchor,
          resolved: t.root.status === "resolved",
        })),
    [visibleThreads]
  );

  const handleDetachedChange = useCallback(
    (ids: string[], positions: ReadonlyMap<string, number>) => {
      setDetachedIds((prev) => {
        if (prev.size === ids.length && ids.every((id) => prev.has(id))) return prev;
        return new Set(ids);
      });
      setAnchorPositions((prev) => {
        if (
          prev.size === positions.size &&
          [...positions].every(([id, pos]) => prev.get(id) === pos)
        ) {
          return prev;
        }
        return new Map(positions);
      });
    },
    []
  );

  const scrollToHighlight = useCallback(
    (commentId: Id<"artifactComments">) => {
      const editable = getEditable(editorWrapperRef.current);
      const anchor = threads.find((t) => t.root._id === commentId)?.root.anchor;
      if (!editable || !anchor) return;
      const located = locateAnchor(textOf(editable), anchor);
      const range = located && rangeForOffsets(editable, located.start, located.end);
      const target = range?.startContainer.parentElement;
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [threads]
  );

  const activateComment = useCallback(
    (commentId: Id<"artifactComments">) => {
      setActiveCommentId(commentId);
      setCommentsOpen(true);
    },
    [setCommentsOpen]
  );

  const handleEditorMouseUp = useCallback(() => {
    const wrapper = editorWrapperRef.current;
    const editable = getEditable(wrapper);
    if (!wrapper || !editable) return;

    const anchor = captureSelection(editable);
    if (anchor) {
      const rects = window.getSelection()?.getRangeAt(0).getClientRects();
      const last = rects && rects.length > 0 ? rects[rects.length - 1] : null;
      const base = wrapper.getBoundingClientRect();
      if (!last) return;
      setSelectionButton({
        anchor,
        top: last.bottom - base.top + 6,
        left: Math.max(0, last.right - base.left - 40),
      });
      return;
    }

    setSelectionButton(null);

    // Collapsed click: activate the comment under the caret (the highlight
    // overlay is pointer-transparent).
    const offset = caretOffset(editable);
    if (offset === null) return;
    const content = textOf(editable);
    const hit = visibleThreads.find((t) => {
      if (!t.root.anchor) return false;
      const range = locateAnchor(content, t.root.anchor);
      return range !== null && offset >= range.start && offset <= range.end;
    });
    if (hit) activateComment(hit.root._id);
  }, [visibleThreads, activateComment]);

  const startPendingComment = useCallback(() => {
    if (!selectionButton) return;
    setPendingComment({ anchor: selectionButton.anchor });
    setSelectionButton(null);
    setCommentsOpen(true);
    window.getSelection()?.removeAllRanges();
  }, [selectionButton, setCommentsOpen]);

  const startGeneralComment = useCallback(() => {
    setPendingComment({ anchor: null });
  }, []);

  const submitPendingComment = useCallback(
    async (commentContent: string) => {
      if (!pendingComment) return;
      const anchor = pendingComment.anchor;
      const id = await createComment(
        commentContent,
        anchor
          ? { ...anchor, endOffset: anchor.startOffset + anchor.text.length }
          : undefined
      );
      setPendingComment(null);
      setActiveCommentId(id);
    },
    [pendingComment, createComment]
  );

  const rootCommentCount = threads.length;
  const showCommentsToggle = !isHtml && (rootCommentCount > 0 || !disabled);

  // Keep the comments-rail header exactly as tall as the editor toolbar so
  // their bottom borders form one continuous line. The toolbar renders
  // asynchronously (same approach as the pinned ToC sync in mdx-editor).
  const [toolbarHeight, setToolbarHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (isHtml || !isCommentsOpen) return;
    const wrapper = editorWrapperRef.current;
    if (!wrapper) return;

    let resizeObserver: ResizeObserver | null = null;
    const observeToolbar = () => {
      const toolbar = wrapper.querySelector(".mdx-editor-kit__toolbar");
      if (!toolbar) return false;
      const sync = () => setToolbarHeight(Math.round(toolbar.getBoundingClientRect().height));
      sync();
      resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(toolbar);
      return true;
    };

    if (observeToolbar()) {
      return () => resizeObserver?.disconnect();
    }
    const mutationObserver = new MutationObserver(() => {
      if (observeToolbar()) mutationObserver.disconnect();
    });
    mutationObserver.observe(wrapper, { childList: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [isHtml, isCommentsOpen]);

  return (
    <ArtifactPanelFrame
      widthCss={widthCss}
      isMobile={isMobile}
      compact={compact}
      fullPage={fullPage}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
          <FileText className="size-4 text-muted-foreground" />
          <input
            type="text"
            value={nameInputValue}
            onChange={(event) => setNameInputValue(event.target.value)}
            disabled={disabled}
            placeholder={UNTITLED_ARTIFACT_NAME}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Artifact name"
          />
        </div>
        <div className="flex items-center gap-1">
          <div
            aria-live="polite"
            className="w-18 py-2 text-xs text-muted-foreground"
            role="status"
          >
            <div className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5">
              <span className="flex size-3 items-center justify-center">
                {saveState === "saving" ? (
                  <Spinner className="size-3" />
                ) : null}
              </span>
              <span className="truncate">{saveStatusText}</span>
            </div>
          </div>
          {!isHtml ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              onClick={toggleFullWidth}
              aria-label={isFullWidth ? "Narrow width" : "Full width"}
              title={isFullWidth ? "Narrow width" : "Full width"}
            >
              {isFullWidth ? <FoldHorizontal /> : <UnfoldHorizontal />}
            </Button>
          ) : null}
          {!fullPage && fullPageHref ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              asChild
              aria-label="Open full page"
              title="Open full page"
            >
              <a href={fullPageHref} target="_blank" rel="noopener noreferrer">
                <Maximize2 />
              </a>
            </Button>
          ) : null}
          {fullPage && backTarget ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              asChild
              aria-label="Back to task"
              title="Back to task"
            >
              <AppLink href={backTarget}>
                <Minimize2 />
              </AppLink>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="cursor-pointer"
            onClick={handleDownload}
            aria-label="Download artifact"
            title="Download artifact"
          >
            <Download />
          </Button>
          {showCommentsToggle ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "relative cursor-pointer",
                isCommentsOpen && "bg-accent text-foreground"
              )}
              onClick={() => setCommentsOpen(!isCommentsOpen)}
              aria-label={isCommentsOpen ? "Hide comments" : "Show comments"}
              title={isCommentsOpen ? "Hide comments" : "Show comments"}
            >
              <MessageSquareText />
              {rootCommentCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border border-border bg-muted px-1 text-[10px] font-medium leading-none text-muted-foreground">
                  {rootCommentCount}
                </span>
              )}
            </Button>
          ) : null}
          {!fullPage && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close artifact"
              title="Close"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {isHtml ? (
        // html artifacts are render-only in-app; content edits happen via MCP/CLI.
        <div className="flex min-h-0 flex-1">
          <HtmlArtifactFrame html={artifact.content} title={artifact.name} />
        </div>
      ) : (
        <div
          ref={commentsContainerRef}
          className={cn("relative flex min-h-0 flex-1", isMobile && "flex-col")}
        >
          <div
            ref={editorScrollContainerRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
          >
            <div
              ref={editorWrapperRef}
              className="relative flex flex-1 flex-col"
              onMouseUp={handleEditorMouseUp}
            >
              <MdxEditor
                value={content}
                onChange={setContent}
                showDiffMode={false}
                stickyToolbar={true}
                density="compact"
                contentPadding="spacious"
                contentWidth={isFullWidth ? "default" : "narrow"}
                disabled={disabled}
                inlineTableOfContents={{ scrollContainerRef: editorScrollContainerRef }}
                className="flex-1"
              />
              <CommentOverlay
                rootRef={editorWrapperRef}
                comments={overlayComments}
                activeId={activeCommentId}
                onDetachedChange={handleDetachedChange}
              />
              {selectionButton && !disabled && (
                <div
                  // Below the sticky toolbar (z-10) so it scrolls under it.
                  className="absolute z-[5]"
                  style={{ top: selectionButton.top, left: selectionButton.left }}
                >
                  <Button
                    size="sm"
                    className="h-7 cursor-pointer gap-1 shadow-md"
                    onClick={startPendingComment}
                  >
                    <MessageSquarePlus className="size-3.5" />
                    Comment
                  </Button>
                </div>
              )}
            </div>
          </div>
          {isCommentsOpen && (
            <>
              {!isMobile && !compact && (
                <SidebarResizeHandle
                  ariaLabel="Resize comments panel"
                  currentWidth={commentsResize.width}
                  bounds={ARTIFACT_COMMENTS_RESIZE_BOUNDS}
                  expandDirection="left"
                  onResizeMouseDown={commentsResize.handleMouseDown}
                  onResizeByStep={commentsResize.adjustWidthBy}
                  // Overlap the rail's left border so the handle adds no gap
                  // between the editor and the comments column.
                  className="relative z-10 -mr-1 shrink-0"
                />
              )}
              <ArtifactCommentsRail
                threads={threads}
                detachedIds={detachedIds}
                anchorPositions={anchorPositions}
                sort={commentSort}
                onSortChange={setCommentSort}
                activeId={activeCommentId}
                onActivate={(id) => {
                  setActiveCommentId(id);
                  scrollToHighlight(id);
                }}
                pending={pendingComment}
                onSubmitPending={submitPendingComment}
                onCancelPending={() => setPendingComment(null)}
                onStartGeneralComment={startGeneralComment}
                showResolved={showResolved}
                onShowResolvedChange={setShowResolved}
                onReply={createReply}
                onUpdate={updateComment}
                onDelete={deleteComment}
                onSetStatus={setStatus}
                readOnly={disabled}
                headerAction={sendToThreadAction}
                headerHeight={isMobile ? undefined : toolbarHeight}
                style={isMobile ? undefined : { width: commentsResize.width }}
                className={cn(
                  "shrink-0",
                  // Mobile stacks the comments as a section under the editor;
                  // compact hosts float them over the editor's right edge —
                  // a docked column would squeeze the editor to nothing.
                  isMobile
                    ? "h-2/5 w-full border-t border-border"
                    : compact
                      ? "absolute inset-y-0 right-0 z-20 max-w-[85%] border-l border-border bg-background shadow-lg"
                      : "border-l border-border"
                )}
              />
            </>
          )}
        </div>
      )}
    </ArtifactPanelFrame>
  );
}

function ArtifactPanelDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      direction="bottom"
    >
      <DrawerContent
        data-testid="task-artifact-drawer"
        className="h-[92dvh] overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=bottom]:rounded-t-lg"
      >
        <DrawerHeader className="sr-only">
          <DrawerTitle>Task artifact</DrawerTitle>
          <DrawerDescription>View and edit the selected task artifact.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

function ArtifactPanelFrame({
  widthCss,
  isMobile,
  compact,
  fullPage = false,
  children,
}: {
  widthCss?: string;
  isMobile: boolean;
  compact: boolean;
  fullPage?: boolean;
  children: ReactNode;
}) {
  if (fullPage) {
    return (
      <div
        data-testid="task-artifact-panel-frame"
        className="flex h-svh min-h-0 flex-col bg-background"
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid="task-artifact-panel-frame"
      style={isMobile || compact ? undefined : { width: widthCss ?? "0px" }}
      className={cn(
        "flex h-full min-h-0 flex-col bg-background",
        isMobile || compact
          ? "min-w-0 flex-1"
          : "shrink-0 border-r border-border"
      )}
    >
      {children}
    </div>
  );
}
