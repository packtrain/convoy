"use client";

import { useCallback, useState } from "react";
import { AtSign, CircleCheck, Download, FileText, GitCompare, RotateCcw } from "lucide-react";
import { PatchDiff, File as FileView } from "@pierre/diffs/react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/custom/empty-state";
import { Spinner } from "@/components/custom/spinner";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";
import { parseFileOpResult } from "@/lib/threads/run-diff-patch";
import { WORKTREE_CHANGES_MIN_CLI_VERSION } from "@/lib/worktrees/cli-version";
import type { WorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";
import { cn } from "@/lib/utils";

type DiffOptions = ReturnType<typeof usePatchDiffOptions>;

export function Message({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <p className={cn("p-4 text-sm", destructive ? "text-destructive" : "text-muted-foreground")}>{children}</p>;
}

export function ErrorWithRetry({ error, onRetry }: { error: string | null; onRetry: () => void }) {
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

export function Fetching() {
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

export function Truncated() {
  return <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">Output truncated — showing the first 700 kB.</p>;
}

export function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success">+{additions}</span> <span className="text-destructive">-{deletions}</span>
    </span>
  );
}

/** `N files +A -D` for the patch on screen, or nothing before it lands. */
export function ChangesSummary({ files }: { files: CliRunDiffFile[] }) {
  if (files.length === 0) {
    return null;
  }
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span>
        {files.length} {files.length === 1 ? "file" : "files"}
      </span>
      {/* Binary files have no line counts; +0 -0 would read as an empty change. */}
      {!files.every((file) => file.binary) && <Counts additions={additions} deletions={deletions} />}
    </span>
  );
}

/**
 * Per-file collapse as XOR over the collapse-all base: a path in the set is
 * flipped from the base, and the set resets when the base flips.
 */
export function useSectionCollapse(allCollapsed: boolean) {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [lastBase, setLastBase] = useState(allCollapsed);
  if (lastBase !== allCollapsed) {
    setLastBase(allCollapsed);
    setToggled(new Set());
  }
  const toggle = useCallback((path: string) => {
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const isCollapsed = useCallback((path: string) => allCollapsed !== toggled.has(path), [allCollapsed, toggled]);
  return { isCollapsed, toggle };
}

/** Text-button switch between scopes, e.g. History's This branch | All (OS-2595). */
export function ScopeToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { scope: T; label: string }[];
  value: T;
  onChange: (scope: T) => void;
}) {
  return (
    <div className="flex w-fit shrink-0 items-center gap-0.5" role="group" aria-label={label}>
      {options.map(({ scope, label: text }) => (
        <Button
          key={scope}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === scope}
          className={cn("h-7 cursor-pointer rounded-md px-2 text-xs text-muted-foreground", value === scope && "bg-muted text-foreground hover:bg-muted")}
          onClick={() => onChange(scope)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

const CHANGES_SCOPES = [
  { scope: "uncommitted", label: "Uncommitted" },
  { scope: "branch", label: "vs main" },
] as const;

/** Uncommitted | vs main (OS-2596); hidden on CLIs without the branch diff. */
export function ChangesScopeToggle({ state }: { state: WorktreeChanges }) {
  if (!state.canScope) {
    return null;
  }
  return <ScopeToggle label="Changes scope" options={CHANGES_SCOPES} value={state.scope} onChange={state.setScope} />;
}

/** Opens the typed-confirmation dialog; hidden on CLIs without `revertWorkingTree`. */
export function RevertAllButton({ state }: { state: WorktreeChanges }) {
  if (!state.canRevertAll || state.files.length === 0) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 cursor-pointer gap-1.5 text-xs text-destructive hover:text-destructive"
      disabled={state.revertAllDisabled}
      title={state.parsed?.truncated ? "The patch is truncated, so not every file is listed" : undefined}
      onClick={() => state.setRevertAllOpen(true)}
    >
      <RotateCcw className="size-3.5" />
      Revert all
    </Button>
  );
}

interface WorktreeChangesBodyProps {
  state: WorktreeChanges;
  diffOptions: DiffOptions;
  wordWrap: boolean;
  isCollapsed: (path: string) => boolean;
  onToggle: (path: string) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  /** Thread sidebar only: insert an `@path` mention into the composer. */
  onMentionFile?: (path: string) => void;
  /** Page only: a clean tree offers the vs main scope. */
  offerBranchScope?: boolean;
}

/** What sits under the tab strip: placeholders, a file tab, or the per-file sections. */
export function WorktreeChangesBody({
  state,
  diffOptions,
  wordWrap,
  isCollapsed,
  onToggle,
  registerSection,
  onMentionFile,
  offerBranchScope = false,
}: WorktreeChangesBodyProps) {
  const diffTheme = useDiffTheme();
  const { entry, isOnline, cliSupported, changes, sections, files, activeTab, fileRead, profile } = state;
  if (!entry) {
    return <Message>This checkout is no longer registered on the CLI.</Message>;
  }
  if (!isOnline) {
    return <Message>CLI offline. Connect it to fetch changes.</Message>;
  }
  if (!cliSupported) {
    return (
      <Message>
        Update @useconvoy/cli to {WORKTREE_CHANGES_MIN_CLI_VERSION} or newer to view changes
        {profile?.appVersion ? ` (connected: v${profile.appVersion})` : ""}.
      </Message>
    );
  }
  if (changes.error && !sections) {
    return <ErrorWithRetry error={changes.error} onRetry={changes.refresh} />;
  }
  if (!sections) {
    return <Fetching />;
  }
  if (activeTab !== null) {
    const content = parseFileOpResult(fileRead.resultJson, "content");
    if (fileRead.loading || (!content && !fileRead.error)) {
      return <Fetching />;
    }
    if (!content) {
      return <ErrorWithRetry error={fileRead.error} onRetry={fileRead.refresh} />;
    }
    if (content.text.length === 0) {
      return <Message>This file is empty.</Message>;
    }
    return (
      <>
        {content.truncated && <Truncated />}
        <FileView
          file={{ name: activeTab, contents: content.text }}
          options={{ ...diffTheme, disableFileHeader: true, overflow: wordWrap ? "wrap" : "scroll" }}
        />
      </>
    );
  }
  if (files.length === 0) {
    return <NoChanges state={state} offerBranchScope={offerBranchScope} />;
  }
  return (
    <div>
      {changes.error && (
        <p className="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Refresh failed: {changes.error} Showing the last fetched changes.
        </p>
      )}
      {state.parsed?.truncated && <Truncated />}
      {files.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          patch={sections.get(file.path)}
          options={diffOptions}
          collapsed={isCollapsed(file.path)}
          onToggle={onToggle}
          registerSection={registerSection}
          onRevertFile={state.canRevert ? state.setRevertTarget : undefined}
          onDownloadFile={state.canDownload ? state.requestDownload : undefined}
          busy={state.busy}
          onOpenFile={state.canOpenFile ? state.openFile : undefined}
          onMentionFile={onMentionFile}
        />
      ))}
    </div>
  );
}

function NoChanges({ state, offerBranchScope }: { state: WorktreeChanges; offerBranchScope: boolean }) {
  if (state.scope === "branch") {
    return <EmptyState icon={GitCompare} title="No changes against main" description="This branch matches the default branch." />;
  }
  const canSwitch = offerBranchScope && state.canScope;
  return (
    <EmptyState
      icon={CircleCheck}
      title="No uncommitted changes"
      description={canSwitch ? "The working tree matches the last commit. Compare with main to see everything this branch changed." : "The working tree matches the last commit."}
      action={
        canSwitch && (
          <Button type="button" variant="secondary" size="sm" className="cursor-pointer" onClick={() => state.setScope("branch")}>
            <GitCompare className="size-3.5" />
            Show changes vs main
          </Button>
        )
      }
    />
  );
}

const ICON_BUTTON = "size-6 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground";

function FileSection({
  file,
  patch,
  options,
  collapsed,
  onToggle,
  registerSection,
  onRevertFile,
  onDownloadFile,
  busy,
  onOpenFile,
  onMentionFile,
}: {
  file: CliRunDiffFile;
  patch: string | undefined;
  options: DiffOptions;
  collapsed: boolean;
  onToggle: (path: string) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  /** Absent where there is nothing to revert (vs main). */
  onRevertFile?: (file: CliRunDiffFile) => void;
  /** Absent on CLIs that cannot upload a file. */
  onDownloadFile?: (path: string) => void;
  /** A revert or download is in flight; both wait for it. */
  busy: boolean;
  /** Absent on CLIs that cannot read from disk. */
  onOpenFile?: (path: string) => void;
  onMentionFile?: (path: string) => void;
}) {
  // Empty files and mode-only changes have a header but no hunks.
  const hasHunks = patch !== undefined && /^@@ /m.test(patch);
  return (
    <PatchFileSection
      file={file}
      patch={hasHunks ? patch : undefined}
      collapsed={collapsed}
      onToggle={onToggle}
      registerSection={registerSection}
      actions={
        <>
          {onMentionFile && file.kind !== "deleted" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={ICON_BUTTON}
              aria-label={`Mention ${file.path} in reply`}
              title="Mention in reply"
              onClick={() => onMentionFile(file.path)}
            >
              <AtSign className="size-3.5" />
            </Button>
          )}
          {onOpenFile && file.kind !== "deleted" && !file.binary && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={ICON_BUTTON}
              aria-label={`Open ${file.path}`}
              title="Open file"
              onClick={() => onOpenFile(file.path)}
            >
              <FileText className="size-3.5" />
            </Button>
          )}
          {onDownloadFile && file.kind !== "deleted" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={ICON_BUTTON}
              aria-label={`Download ${file.path}`}
              title="Download file"
              disabled={busy}
              onClick={() => onDownloadFile(file.path)}
            >
              <Download className="size-3.5" />
            </Button>
          )}
          {onRevertFile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={ICON_BUTTON}
              aria-label={`Revert ${file.path}`}
              title="Revert file"
              disabled={busy}
              onClick={() => onRevertFile(file)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </>
      }
    >
      {hasHunks ? (
        <PatchDiff patch={patch} options={options} />
      ) : (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          No content change{file.kind === "modified" ? " (mode only)" : " (empty file)"}.
        </p>
      )}
    </PatchFileSection>
  );
}
