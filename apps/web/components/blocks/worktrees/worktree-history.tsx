"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, GitCommitHorizontal, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { PatchDiff } from "@pierre/diffs/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { WORKTREE_HISTORY_MIN_CLI_VERSION, supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import { type CommitSummary, type WorktreeHistory, useCommitPatch } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ChangesSummary, ErrorWithRetry, Fetching, Message, Truncated, useSectionCollapse } from "./worktree-changes-body";

type DiffOptions = ReturnType<typeof usePatchDiffOptions>;

const ROW_HEIGHT = 52;
const short = (hash: string) => hash.slice(0, 7);
const noop = () => {};

function RefBadge({ name }: { name: string }) {
  const head = name.startsWith("HEAD -> ");
  return (
    <span
      className={cn(
        "max-w-40 shrink-0 truncate rounded-sm border px-1 font-mono text-[11px] leading-4",
        head
          ? "border-info/40 bg-info/10 text-info"
          : name.startsWith("origin/")
            ? "border-border text-muted-foreground"
            : "border-border text-foreground"
      )}
      title={name}
    >
      {head ? name.slice("HEAD -> ".length) : name}
    </span>
  );
}

function CommitRow({ commit, selected, onSelect }: { commit: CommitSummary; selected: boolean; onSelect: () => void }) {
  const merge = commit.parents.length > 1;
  const Icon = merge ? GitMerge : GitCommitHorizontal;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 border-b border-border pr-3 pl-3 text-left hover:bg-muted/60",
        selected && "bg-muted"
      )}
    >
      <Icon className="mt-[11px] size-3.5 shrink-0 self-start text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-sm", merge && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate" title={commit.authorEmail}>
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
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Failed to copy the hash");
        }
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {short(hash)}
    </Button>
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
              // ponytail: combined diffs render as text; the diff viewer reads two-sided patches only.
              <pre className={cn("px-4 py-2 font-mono text-xs", wordWrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto")}>{section}</pre>
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
  onSelectHash,
  diffOptions,
  allCollapsed,
  wordWrap,
}: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  commit: CommitSummary;
  loadedHashes: ReadonlySet<string>;
  onSelectHash: (hash: string) => void;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
}) {
  const patch = useCommitPatch(profileId, pathId, commit.hash, true);
  const merge = commit.parents.length > 1;
  return (
    <div>
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{commit.subject}</h2>
        {patch.result?.body && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{patch.result.body}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          <span>{new Date(commit.committedAt).toLocaleString()}</span>
          <CopyHash hash={commit.hash} />
          {commit.parents.length > 0 && (
            <span className="flex items-center gap-1">
              {merge ? "Parents" : "Parent"}
              {commit.parents.map((parent) => (
                <button
                  key={parent}
                  type="button"
                  className="cursor-pointer font-mono enabled:hover:text-foreground enabled:hover:underline disabled:cursor-default"
                  disabled={!loadedHashes.has(parent)}
                  title={loadedHashes.has(parent) ? undefined : "Not loaded yet"}
                  onClick={() => onSelectHash(parent)}
                >
                  {short(parent)}
                </button>
              ))}
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
  isOnline: boolean;
  appVersion: string | undefined;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
}

const PANES = "grid h-full min-h-0 grid-cols-[340px_minmax(0,1fr)]";

/**
 * History tab of the worktree page (OS-2534): commit list left, the selected
 * commit right. On a phone one pane at a time, the list first.
 */
export function WorktreeHistoryView({
  profileId,
  pathId,
  history,
  isOnline,
  appVersion,
  diffOptions,
  allCollapsed,
  wordWrap,
}: WorktreeHistoryViewProps) {
  const isMobile = useIsMobile();
  const { commits, selectedHash, select } = history;
  const loadedHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits]);

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
    return isMobile ? (
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

  const picked = commits.find((commit) => commit.hash === selectedHash);
  const selected = picked ?? commits[0];
  const detail = (
    <CommitDetail
      key={selected.hash}
      profileId={profileId}
      pathId={pathId}
      commit={selected}
      loadedHashes={loadedHashes}
      onSelectHash={select}
      diffOptions={diffOptions}
      allCollapsed={allCollapsed}
      wordWrap={wordWrap}
    />
  );
  if (isMobile && picked) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button
          type="button"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => select(null)}
        >
          <ArrowLeft className="size-3.5" />
          History
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
      </div>
    );
  }
  return (
    <div className={isMobile ? "h-full min-h-0" : PANES}>
      <div className={cn("min-h-0 overflow-y-auto", isMobile ? "h-full" : "border-r border-border")}>
        {commits.map((commit) => (
          <CommitRow
            key={commit.hash}
            commit={commit}
            selected={!isMobile && commit.hash === selected.hash}
            onSelect={() => select(commit.hash)}
          />
        ))}
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
                onClick={history.loadMore}
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
      {!isMobile && <div className="min-h-0 overflow-y-auto">{detail}</div>}
    </div>
  );
}
