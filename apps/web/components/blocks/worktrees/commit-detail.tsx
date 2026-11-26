"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Tag } from "lucide-react";
import { toast } from "sonner";
import { PatchDiff } from "@pierre/diffs/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PatchFileSection, type usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { type CommitSummary, useCommitPatch } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ErrorWithRetry, Fetching, Message, Truncated, useSectionCollapse, ChangesSummary } from "./worktree-changes-body";

export type DiffOptions = ReturnType<typeof usePatchDiffOptions>;

export const short = (hash: string) => hash.slice(0, 7);
/** Badges to draw: `origin/HEAD` only repeats the default branch's badge. */
export const visibleRefs = (commit: CommitSummary) => commit.refs.filter((ref) => ref !== "origin/HEAD");
export const emptyCommitMessage = (merge: boolean) =>
  merge ? "Merge commit with no conflict resolutions to show." : "This commit changes no files.";

/** The branch or tag a `%D` entry names, as its badge shows it. */
export const refName = (ref: string) =>
  ref.startsWith("HEAD -> ") ? ref.slice("HEAD -> ".length) : ref.startsWith("tag: ") ? ref.slice("tag: ".length) : ref;

export function RefBadge({ name, className }: { name: string; className?: string }) {
  const head = name.startsWith("HEAD -> ");
  const tag = name.startsWith("tag: ");
  return (
    <span
      className={cn(
        "flex max-w-40 min-w-0 items-center gap-0.5 rounded-sm border px-1 font-mono text-[11px] leading-4",
        className,
        head
          ? "border-info/40 bg-info/10 text-info"
          : name.startsWith("origin/")
            ? "border-border text-muted-foreground"
            : "border-border text-foreground"
      )}
      title={name}
    >
      {tag && <Tag className="size-2.5 shrink-0" aria-hidden />}
      <span className="truncate">{refName(name)}</span>
    </span>
  );
}

/** `CommitDetail`'s header block and a few file section bars. */
export function CommitDetailSkeleton() {
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

/** `full`: the button shows the whole hash, as the Graph sidebar does. */
export function CopyHash({ hash, full = false }: { hash: string; full?: boolean }) {
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
      {full ? hash : short(hash)}
    </Button>
  );
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)]) /;

/** A list item's wrapped lines, indented to its text, join the item; every other line keeps its break. */
function joinListContinuations(paragraph: string) {
  const lines: string[] = [];
  let indent: string | null = null;
  for (const line of paragraph.split("\n")) {
    const item = LIST_ITEM.exec(line);
    if (!item && indent !== null && line.startsWith(indent) && /\S/.test(line[indent.length] ?? "")) {
      lines[lines.length - 1] += ` ${line.slice(indent.length)}`;
      continue;
    }
    indent = item ? " ".repeat(item[0].length) : null;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Joins git's hard-wrapped lines into paragraphs; a paragraph with list or indented lines keeps its breaks,
 * except a list item's two-space continuation lines, which join the item.
 */
export function CommitBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap break-words">
          {/^(\s|[-*+] |\d+[.)] )/m.test(paragraph) ? joinListContinuations(paragraph) : paragraph.replace(/\n/g, " ")}
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

export function CommitFiles({
  patch,
  diffOptions,
  allCollapsed,
  wordWrap,
  merge,
  scrollTo,
}: {
  patch: string;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
  merge: boolean;
  /** A file picked in the Graph sidebar: expanded and scrolled to; a new object scrolls again. */
  scrollTo?: { path: string };
}) {
  const sections = useMemo(() => splitRunPatch(patch), [patch]);
  const files = useMemo(() => parseRunPatchFiles(sections), [sections]);
  const collapse = useSectionCollapse(allCollapsed);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) {
      sectionRefs.current.set(path, element);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);
  const scrolledTo = useRef<{ path: string } | undefined>(undefined);
  const { isCollapsed, toggle } = collapse;
  useEffect(() => {
    const element = scrollTo && sectionRefs.current.get(scrollTo.path);
    if (!scrollTo || !element || scrolledTo.current === scrollTo) {
      return;
    }
    // A collapsed file expands first; the scroll waits for the next run, once its body is laid out.
    if (isCollapsed(scrollTo.path)) {
      toggle(scrollTo.path);
      return;
    }
    scrolledTo.current = scrollTo;
    element.scrollIntoView?.({ block: "start" });
  }, [scrollTo, isCollapsed, toggle]);
  if (files.length === 0) {
    return <Message>{emptyCommitMessage(merge)}</Message>;
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
            registerSection={registerSection}
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

export function CommitDetail({
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
