"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, Copy, GitCommitHorizontal, GitMerge, Tag } from "lucide-react";
import { toast } from "sonner";
import { PatchDiff } from "@pierre/diffs/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { WORKTREE_HISTORY_MIN_CLI_VERSION, supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import { type CommitSummary, type WorktreeHistory, useCommitPatch } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ChangesSummary, ErrorWithRetry, Fetching, Message, Truncated, useSectionCollapse } from "./worktree-changes-body";

type DiffOptions = ReturnType<typeof usePatchDiffOptions>;

const ROW_HEIGHT = 52;
/** A screen reader reads the label on every arrow press; the full subject stays in the row. */
const LABEL_SUBJECT_CHARS = 120;
const short = (hash: string) => hash.slice(0, 7);
const noop = () => {};

function RefBadge({ name }: { name: string }) {
  const head = name.startsWith("HEAD -> ");
  const tag = name.startsWith("tag: ");
  return (
    <span
      className={cn(
        "flex max-w-40 min-w-0 items-center gap-0.5 rounded-sm border px-1 font-mono text-[11px] leading-4",
        head
          ? "border-info/40 bg-info/10 text-info"
          : name.startsWith("origin/")
            ? "border-border text-muted-foreground"
            : "border-border text-foreground"
      )}
      title={name}
    >
      {tag && <Tag className="size-2.5 shrink-0" aria-hidden />}
      <span className="truncate">{head ? name.slice("HEAD -> ".length) : tag ? name.slice("tag: ".length) : name}</span>
    </span>
  );
}

function CommitRow({
  commit,
  selected,
  tabbable,
  onSelect,
  onFocus,
}: {
  commit: CommitSummary;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onFocus: () => void;
}) {
  const merge = commit.parents.length > 1;
  const Icon = merge ? GitMerge : GitCommitHorizontal;
  return (
    <button
      type="button"
      role="option"
      data-hash={commit.hash}
      onClick={onSelect}
      onFocus={onFocus}
      aria-selected={selected}
      aria-label={`${commit.subject.length > LABEL_SUBJECT_CHARS ? `${commit.subject.slice(0, LABEL_SUBJECT_CHARS - 1)}…` : commit.subject}, ${commit.authorName}, ${new Date(commit.committedAt).toLocaleString()}`}
      tabIndex={tabbable ? 0 : -1}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 border-b border-border pr-3 pl-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        selected && "bg-muted shadow-[inset_2px_0_0_var(--color-primary)]"
      )}
    >
      <Icon className="mt-[11px] size-3.5 shrink-0 self-start text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-sm", merge && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
          <span className="max-w-32 shrink-0 truncate" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          <span>·</span>
          <span className="shrink-0" title={new Date(commit.committedAt).toLocaleString()}>
            {formatCompactRelativeTime(commit.committedAt)}
          </span>
          <span className="shrink-0 font-mono">{short(commit.hash)}</span>
          {commit.refs.map((ref) => (
            <RefBadge key={ref} name={ref} />
          ))}
        </span>
      </span>
    </button>
  );
}

/** `CommitDetail`'s header block and a few file section bars. */
function CommitDetailSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="border-b border-border px-4 py-2">
        <Skeleton className="h-3 w-28" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-2 border-b border-border px-2 py-2">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3" style={{ width: `${30 + index * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Rows at the loaded list's height: icon, subject line, meta line. */
function CommitListSkeleton() {
  return (
    <div aria-label="Loading commits">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} style={{ height: ROW_HEIGHT }} className="flex items-center gap-2 border-b border-border px-3">
          <Skeleton className="size-3.5 shrink-0 self-start mt-[11px] rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((index * 17) % 40)}%` }} />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    // Without a clipboard the hash stays reachable: selected on mount, ready for Ctrl+C.
    return (
      <input
        ref={(element) => element?.select()}
        readOnly
        aria-label="Full commit hash"
        value={hash}
        size={hash.length}
        onFocus={(event) => event.currentTarget.select()}
        className="h-6 max-w-full rounded-sm border border-border bg-background px-1 font-mono text-xs text-foreground"
      />
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="cursor-pointer gap-1 font-mono text-xs text-muted-foreground"
      title="Copy full hash"
      aria-label={`Copy commit hash ${short(hash)}`}
      onClick={async () => {
        // Throws where `navigator.clipboard` is absent (plain-HTTP self-hosting) or denied.
        try {
          await navigator.clipboard.writeText(hash);
          toast.success("Commit hash copied");
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Failed to copy the hash", { description: "The full hash is selected beside it. Press Ctrl+C." });
          setFailed(true);
        }
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {short(hash)}
    </Button>
  );
}

/** Joins git's hard-wrapped lines into paragraphs; a paragraph with list or indented lines keeps its breaks. */
function CommitBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap break-words">
          {/^(\s|[-*+] |\d+[.)] )/m.test(paragraph) ? paragraph : paragraph.replace(/\n/g, " ")}
        </p>
      ))}
    </div>
  );
}

/** `git show --cc` section without git's header lines; a line is tinted by its per-parent +/- columns. */
function CombinedSection({ section, wordWrap }: { section: string; wordWrap: boolean }) {
  const lines = section.split("\n");
  const body = lines.slice(
    Math.max(
      0,
      lines.findIndex((line) => line.startsWith("@@"))
    )
  );
  if (body.at(-1) === "") {
    body.pop();
  }
  const columns = Math.max(1, (/^@+/.exec(body[0] ?? "")?.[0].length ?? 2) - 1);
  return (
    <>
      <p className="px-4 pt-2 text-xs text-muted-foreground">Combined diff of the merge resolution, shown unified.</p>
      <pre className={cn("px-4 py-2 font-mono text-xs", wordWrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto")}>
        {body.map((line, index) => {
          const marks = line.slice(0, columns);
          return (
            <span
              key={index}
              className={cn(
                "block",
                line.startsWith("@@")
                  ? "text-muted-foreground"
                  : marks.includes("+")
                    ? "bg-success/10"
                    : marks.includes("-") && "bg-destructive/10"
              )}
            >
              {line}
            </span>
          );
        })}
      </pre>
    </>
  );
}

function CommitFiles({
  patch,
  diffOptions,
  allCollapsed,
  wordWrap,
  merge,
}: {
  patch: string;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
  merge: boolean;
}) {
  const sections = useMemo(() => splitRunPatch(patch), [patch]);
  const files = useMemo(() => parseRunPatchFiles(sections), [sections]);
  const collapse = useSectionCollapse(allCollapsed);
  if (files.length === 0) {
    return <Message>{merge ? "Merge commit with no conflict resolutions to show." : "This commit changes no files."}</Message>;
  }
  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <ChangesSummary files={files} />
      </div>
      {files.map((file) => {
        const section = sections.get(file.path);
        const hasHunks = section !== undefined && /^@@/m.test(section);
        return (
          <PatchFileSection
            key={file.path}
            file={file}
            patch={hasHunks ? section : undefined}
            collapsed={collapse.isCollapsed(file.path)}
            onToggle={collapse.toggle}
            registerSection={noop}
          >
            {!hasHunks ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">No content change.</p>
            ) : section.startsWith("diff --cc ") ? (
              // ponytail: combined diffs render as tinted text; the diff viewer reads two-sided patches only.
              <CombinedSection section={section} wordWrap={wordWrap} />
            ) : (
              <PatchDiff patch={section} options={diffOptions} />
            )}
          </PatchFileSection>
        );
      })}
    </>
  );
}

function CommitDetail({
  profileId,
  pathId,
  commit,
  loadedHashes,
  canLoadMore,
  onOpenParent,
  headingRef,
  diffOptions,
  allCollapsed,
  wordWrap,
}: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  commit: CommitSummary;
  loadedHashes: ReadonlySet<string>;
  canLoadMore: boolean;
  onOpenParent: (hash: string) => void;
  headingRef: React.Ref<HTMLHeadingElement>;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
}) {
  const patch = useCommitPatch(profileId, pathId, commit.hash, true);
  const merge = commit.parents.length > 1;
  return (
    <div>
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <h2 ref={headingRef} tabIndex={-1} data-hash={commit.hash} className="text-sm font-medium break-words outline-none">
          {commit.subject}
        </h2>
        {patch.result?.body && <CommitBody body={patch.result.body} />}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          <span>{new Date(commit.committedAt).toLocaleString()}</span>
          <CopyHash hash={commit.hash} />
          {commit.parents.length > 0 && (
            <span className="flex items-center gap-1">
              {merge ? "Parents" : "Parent"}
              {commit.parents.map((parent) => {
                const loaded = loadedHashes.has(parent);
                return (
                  <button
                    key={parent}
                    type="button"
                    className="inline-flex min-h-6 cursor-pointer items-center px-0.5 font-mono underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-default disabled:no-underline"
                    disabled={!loaded && !canLoadMore}
                    // A parent past the loaded pages loads the next page and opens once it arrives.
                    title={loaded ? undefined : canLoadMore ? "Loads more commits to open it" : "Not in this history"}
                    aria-label={`Open parent ${short(parent)}`}
                    onClick={() => onOpenParent(parent)}
                  >
                    {short(parent)}
                  </button>
                );
              })}
            </span>
          )}
        </div>
      </div>
      {patch.result ? (
        <>
          {patch.result.truncated && <Truncated />}
          <CommitFiles patch={patch.result.patch} diffOptions={diffOptions} allCollapsed={allCollapsed} wordWrap={wordWrap} merge={merge} />
        </>
      ) : patch.error ? (
        <ErrorWithRetry error={patch.error} onRetry={patch.retry} />
      ) : (
        <Fetching />
      )}
    </div>
  );
}

interface WorktreeHistoryViewProps {
  profileId: Id<"cliProfiles">;
  pathId: string;
  history: WorktreeHistory;
  /** False when the path is gone from the CLI's profile. */
  registered: boolean;
  isOnline: boolean;
  appVersion: string | undefined;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
  /** The open commit (the URL's `commit`); null shows the newest, or the list in one-pane mode. */
  selectedHash: string | null;
  /** `push` when the pane changes in one-pane mode, so Back returns to the list; `back` pops that entry. */
  onSelect: (hash: string | null, mode: "push" | "replace" | "back") => void;
}

/** Below this pane width the list and the commit take turns, as on a phone. */
const ONE_PANE_BELOW = 600;
const PANES = "grid h-full min-h-0 grid-cols-[clamp(240px,40%,420px)_minmax(0,1fr)]";
const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };
// ponytail: a linked commit is found by paging, capped at 1,000 rows per seek; a lookup op if links go deeper.
const MAX_SEEK_ROWS = 1000;

type PendingFocus = { kind: "heading"; hash: string } | { kind: "row"; hash: string } | { kind: "rowAt"; index: number };

/** A full hash, or a short one (7+ characters) that starts it. */
const matches = (commit: CommitSummary, hash: string) => commit.hash === hash || (hash.length >= 7 && commit.hash.startsWith(hash));

/**
 * History tab of the worktree page (OS-2534): commit list left, the selected
 * commit right. In a narrow pane or on a phone one pane at a time, the list first.
 */
export function WorktreeHistoryView({
  profileId,
  pathId,
  history,
  registered,
  isOnline,
  appVersion,
  diffOptions,
  allCollapsed,
  wordWrap,
  selectedHash,
  onSelect,
}: WorktreeHistoryViewProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const onePane = isMobile || (width !== null && width < ONE_PANE_BELOW);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  const { commits } = history;
  const loadedHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits]);

  const found = selectedHash === null ? undefined : commits.find((commit) => matches(commit, selectedHash));
  // The last commit opened stays open while the selected hash is off the loaded pages (after a Refresh, or a parent still loading).
  const [kept, setKept] = useState<CommitSummary | null>(null);
  if (found && found !== kept) {
    setKept(found);
  }
  const opened = selectedHash === null ? undefined : (found ?? kept ?? undefined);
  // A selected hash that is not loaded yet is paged to, the way a linked commit or a far parent needs.
  const [seekStart, setSeekStart] = useState({ hash: selectedHash, rows: commits.length });
  if (seekStart.hash !== selectedHash) {
    setSeekStart({ hash: selectedHash, rows: commits.length });
  }
  const canSeek = history.hasMore && commits.length - seekStart.rows < MAX_SEEK_ROWS && !history.error;
  const seeking = selectedHash !== null && !found && !history.initialLoading && (history.loadingMore || canSeek);
  const shown = opened ?? (seeking ? undefined : commits[0]);
  const pushedHash = useRef<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  // A hash paging could not find; the note above the list outlives the URL param.
  const missing = selectedHash !== null && !found && !seeking && !history.initialLoading && !history.error && commits.length > 0;
  const [missingHash, setMissingHash] = useState<string | null>(null);
  if (missing && missingHash !== selectedHash) {
    setMissingHash(selectedHash);
  }

  // Back to the commit that was open only while it is still in the history; a rebase or reset may have dropped it.
  const fallbackHash = kept && kept.hash !== selectedHash && loadedHashes.has(kept.hash) ? kept.hash : null;
  useEffect(() => {
    if (missing) {
      onSelect(fallbackHash, "replace");
    }
  }, [missing, fallbackHash, onSelect]);

  useEffect(() => {
    if (seeking && !history.loadingMore && canSeek) {
      history.loadMore();
    }
  });

  // The open row scrolls into view when it changes or arrives by paging; "nearest" leaves a visible row alone.
  const foundHash = found?.hash;
  useEffect(() => {
    if (foundHash) {
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${foundHash}"]`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [foundHash]);

  useEffect(() => {
    // Back to the list in one-pane mode, by the back row or the browser: the row you came from gets focus.
    const now = opened?.hash ?? null;
    if (onePane && lastOpened.current && !now && !pendingFocus.current) {
      pendingFocus.current = { kind: "row", hash: lastOpened.current };
    }
    // Browser Forward (or a link) opens the commit pane without a click: its heading gets focus.
    if (onePane && !lastOpened.current && now && !pendingFocus.current) {
      pendingFocus.current = { kind: "heading", hash: now };
    }
    lastOpened.current = now;

    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    const element =
      target.kind === "heading"
        ? headingRef.current?.dataset.hash === target.hash
          ? headingRef.current
          : null
        : target.kind === "row"
          ? listRef.current?.querySelector<HTMLElement>(`[data-hash="${target.hash}"]`)
          : listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[target.index];
    if (!element || element.closest("[hidden]")) {
      return; // Not rendered yet: the page is still loading.
    }
    element.focus();
    element.scrollIntoView?.({ block: "nearest" });
    pendingFocus.current = null;
  });

  const open = (hash: string) => {
    setMissingHash(null);
    pendingFocus.current = onePane ? { kind: "heading", hash } : { kind: "row", hash };
    if (onePane) {
      pushedHash.current = hash;
    }
    onSelect(hash, onePane ? "push" : "replace");
  };
  const openParent = (hash: string) => {
    pendingFocus.current = onePane ? { kind: "heading", hash } : { kind: "row", hash };
    // The pushed entry now holds the parent, so the back row still pops it.
    if (pushedHash.current !== null && pushedHash.current === selectedHash) {
      pushedHash.current = hash;
    }
    onSelect(hash, "replace");
  };
  const backToList = () => {
    const popsOwnEntry = pushedHash.current !== null && pushedHash.current === selectedHash;
    pushedHash.current = null;
    onSelect(null, popsOwnEntry ? "back" : "replace");
  };
  const loadMore = () => {
    pendingFocus.current = { kind: "rowAt", index: commits.length };
    history.loadMore();
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS[event.key];
    const hash = (event.target as HTMLElement).dataset.hash;
    const edge = event.key === "Home" ? commits[0] : event.key === "End" ? commits.at(-1) : undefined;
    if ((!step && !edge) || !hash || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const next = edge ?? commits[commits.findIndex((commit) => commit.hash === hash) + step];
    if (!next) {
      return;
    }
    event.preventDefault();
    if (onePane) {
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${next.hash}"]`)?.focus();
    } else {
      open(next.hash);
    }
  };

  const body = () => {
    if (!registered) {
      return <Message>This checkout is no longer registered on the CLI.</Message>;
    }
    if (!isOnline) {
      return <Message>CLI offline. Connect it to fetch history.</Message>;
    }
    if (!supportsWorktreeHistory(appVersion)) {
      return (
        <Message>
          Update @useconvoy/cli to {WORKTREE_HISTORY_MIN_CLI_VERSION} or newer to view history
          {appVersion ? ` (connected: v${appVersion})` : ""}.
        </Message>
      );
    }
    if (history.error && commits.length === 0) {
      return <ErrorWithRetry error={history.error} onRetry={history.retry} />;
    }
    if (history.initialLoading) {
      return onePane ? (
        <CommitListSkeleton />
      ) : (
        <div className={PANES}>
          <div className="min-h-0 overflow-y-auto border-r border-border">
            <CommitListSkeleton />
          </div>
          <CommitDetailSkeleton />
        </div>
      );
    }
    if (commits.length === 0) {
      return <Message>No commits on this branch yet.</Message>;
    }

    const detailOpen = !onePane || opened !== undefined || seeking;
    // In one-pane mode the row marks the commit you came from.
    const markedHash = onePane ? kept?.hash : shown?.hash;
    const tabbableHash = [focusedHash, shown?.hash, commits[0].hash].find((hash) => hash != null && loadedHashes.has(hash));
    const list = (
      <div
        className={cn("min-h-0 overflow-y-auto", onePane ? "h-full" : "border-r border-border", isMobile && "pb-(--mobile-nav-clearance)")}
        hidden={onePane && detailOpen}
      >
        {missingHash && <Message>{`Commit ${short(missingHash)} isn't in this branch's history.`}</Message>}
        <div ref={listRef} role="listbox" aria-label="Commits" onKeyDown={onListKeyDown}>
          {commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              selected={commit.hash === markedHash}
              tabbable={commit.hash === tabbableHash}
              onSelect={() => open(commit.hash)}
              onFocus={() => setFocusedHash(commit.hash)}
            />
          ))}
        </div>
        {history.error ? (
          <ErrorWithRetry error={history.error} onRetry={history.retry} />
        ) : (
          (history.hasMore || history.loadingMore) && (
            <div className="p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full cursor-pointer text-xs text-muted-foreground"
                disabled={history.loadingMore}
                onClick={loadMore}
              >
                {history.loadingMore ? (
                  <Spinner className="text-xs" text="Loading…" textPlacement="inline" textClassName="text-current" />
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )
        )}
      </div>
    );
    const detail = detailOpen && (
      <div className={cn("min-h-0 overflow-y-auto", isMobile && "pb-(--mobile-nav-clearance)")}>
        {/* The page that would bring the selected commit failed; in one-pane mode the list's own error is hidden. */}
        {onePane && selectedHash !== null && !found && history.error && <ErrorWithRetry error={history.error} onRetry={history.retry} />}
        {shown ? (
          <CommitDetail
            key={shown.hash}
            profileId={profileId}
            pathId={pathId}
            commit={shown}
            loadedHashes={loadedHashes}
            canLoadMore={history.hasMore}
            onOpenParent={openParent}
            headingRef={headingRef}
            diffOptions={diffOptions}
            allCollapsed={allCollapsed}
            wordWrap={wordWrap}
          />
        ) : (
          <div className="p-4">
            <Spinner
              className="text-sm text-muted-foreground"
              text={`Finding commit ${short(selectedHash ?? "")}… ${commits.length} commits searched`}
              textClassName="text-current"
              textPlacement="inline"
            />
          </div>
        )}
      </div>
    );
    if (!onePane) {
      return (
        <div className={PANES}>
          {list}
          {detail}
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        {list}
        {detailOpen && (
          <>
            <button
              type="button"
              className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={backToList}
            >
              <ArrowLeft className="size-3.5" />
              All commits
            </button>
            {detail}
          </>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="h-full min-h-0">
      {body()}
    </div>
  );
}
