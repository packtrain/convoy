"use client";

import { Fragment, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Ellipsis, FolderGit2, Lock, Pencil, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_WORKTREE_SETUP_SCRIPT_LENGTH } from "@/convex/cli/lib/constants";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { EmptyState } from "@/components/custom/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getMutationErrorMessage } from "@/lib/errors";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

type Row = FunctionReturnType<typeof api.cli.worktreeSetups.list>[number];
type Setup = NonNullable<Row["setup"]>;

const APPROVAL_BADGES: Record<Setup["approval"], { label: string; className: string }> = {
  approved: { label: "Approved", className: "text-muted-foreground" },
  never: { label: "Needs your approval", className: "text-warning" },
  changed: { label: "Changed since you approved", className: "text-warning" },
};

function editorName(setup: Setup): string {
  return setup.updatedByName ?? "A former member";
}

function lastEdited(setup: Setup): string {
  return `Last edited by ${setup.updatedByName ?? "a former member"}, ${formatRelativeTime(setup.updatedAt)}`;
}

/** The dialog's call to approve, for a version the caller has not approved. */
const APPROVAL_PROMPTS: Record<Exclude<Setup["approval"], "approved">, (name: string) => string> = {
  never: (name) => `${name} saved this script. Your CLIs won't run it until you approve it.`,
  changed: (name) => `${name} changed this script since you approved it. Your CLIs won't run it until you approve it again.`,
};

const EXAMPLE_SCRIPT = `# Example
cp "$CONVOY_PARENT_PATH/.mcp.json" .
cp "$CONVOY_PARENT_PATH/apps/web/.env.local" apps/web/
pnpm i`;

const ENV_VARS = [
  ["CONVOY_PARENT_PATH", "root of the checkout the worktree was created from"],
  ["CONVOY_WORKTREE_PATH", "root of the new worktree (also the working directory)"],
  ["CONVOY_BRANCH", "the worktree's branch"],
] as const;

// The length counter shows from here on, before Save is blocked at the limit.
const LENGTH_HINT_FROM = MAX_WORKTREE_SETUP_SCRIPT_LENGTH * 0.9;

function lengthHint(length: number): string {
  const limit = MAX_WORKTREE_SETUP_SCRIPT_LENGTH.toLocaleString("en-US");
  const over = length - MAX_WORKTREE_SETUP_SCRIPT_LENGTH;
  if (over <= 0) return `${length.toLocaleString("en-US")} / ${limit} characters`;
  return `${over.toLocaleString("en-US")} ${over === 1 ? "character" : "characters"} over the ${limit} limit`;
}

/** Project settings → Worktrees: one setup script per repo (docs/specs/cli-worktrees.md#worktree-setup-scripts). */
export function WorktreeSetupsSettingsSection({ projectId, canEdit }: { projectId: Id<"projects"> | null; canEdit: boolean }) {
  const rows = useQuery(api.cli.worktreeSetups.list, projectId ? { projectId } : "skip");
  // A repo key, not a row snapshot: the open dialog follows the live row (a teammate's save).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // A repo that leaves the list (removed, and not one of the caller's paths) keeps its editor, as removed.
  const editing = editingKey ? (rows?.find((row) => row.repoKey === editingKey) ?? { repoKey: editingKey, setup: null }) : null;
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  // The dialogs have no trigger for Radix to return focus to, so the row takes it back on close.
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRow = (repoKey: string) => rowButtons.current.get(repoKey)?.focus();

  if (!projectId || rows === undefined) {
    return (
      <div role="status" aria-label="Loading repositories">
        <SettingsCatalogListFrame>
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-1 p-4" aria-hidden>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          ))}
        </SettingsCatalogListFrame>
      </div>
    );
  }

  // Keyed, so the list and the empty state below keep the same editor instance.
  const dialogs = (
    <Fragment key="dialogs">
      {editing ? (
        <ScriptDialog projectId={projectId} row={editing} canEdit={canEdit} onClose={() => setEditingKey(null)} onFocusRow={focusRow} />
      ) : null}
      <RemoveDialog projectId={projectId} repoKey={removingKey} onClose={() => setRemovingKey(null)} onFocusRow={focusRow} />
    </Fragment>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={FolderGit2}
          title="No repositories yet"
          description="A repository appears here once one of your CLIs connects a path with a Git origin."
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!canEdit ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Only project admins can edit setup scripts.
        </div>
      ) : null}
      <SettingsCatalogListFrame>
        {rows.map((row) => (
          <div key={row.repoKey} className="flex items-stretch transition-colors hover:bg-muted/50">
            <button
              ref={(node) => {
                if (node) rowButtons.current.set(row.repoKey, node);
                else rowButtons.current.delete(row.repoKey);
              }}
              type="button"
              onClick={() => setEditingKey(row.repoKey)}
              aria-label={row.setup ? `${row.repoKey}, ${APPROVAL_BADGES[row.setup.approval].label}` : row.repoKey}
              aria-describedby={`worktree-setup-detail-${row.repoKey}`}
              className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            >
              {/* The badge wraps under the repo key on a narrow screen instead of truncating it. */}
              <span className="flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="max-w-full truncate font-mono text-sm font-medium">{row.repoKey}</span>
                {row.setup ? (
                  <Badge
                    variant="outline"
                    shape="rounded"
                    data-testid="approval-badge"
                    className={cn("shrink-0", APPROVAL_BADGES[row.setup.approval].className)}
                  >
                    {APPROVAL_BADGES[row.setup.approval].label}
                  </Badge>
                ) : null}
              </span>
              <span id={`worktree-setup-detail-${row.repoKey}`} className="max-w-full truncate text-xs text-muted-foreground">
                {row.setup ? lastEdited(row.setup) : "No setup script"}
              </span>
            </button>
            {canEdit && row.setup ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label={`${row.repoKey} actions`}
                    className="my-auto mr-4 shrink-0 text-muted-foreground"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setEditingKey(row.repoKey)}>
                    <Pencil className="size-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setRemovingKey(row.repoKey)}>
                    <Trash2 className="size-4" /> Remove setup script
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ))}
      </SettingsCatalogListFrame>
      {dialogs}
    </div>
  );
}

/** The editor, also the thread's review dialog: with `onRetry`, Approve retries the run, and Retry replaces it when nothing needs approval. */
export function ScriptDialog({
  projectId,
  row,
  canEdit,
  onClose,
  onFocusRow,
  onRetry,
  isRetrying = false,
}: {
  projectId: Id<"projects">;
  row: Row;
  canEdit: boolean;
  onClose: () => void;
  onFocusRow: (repoKey: string) => void;
  onRetry?: (approvedNow: boolean) => Promise<void>;
  isRetrying?: boolean;
}) {
  const save = useMutation(api.cli.worktreeSetups.save);
  const approve = useMutation(api.cli.worktreeSetups.approve);
  // The version on screen stays pinned when a teammate saves, so Approve and Save name the revision the reader read.
  const [seen, setSeen] = useState(row.setup);
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // What to do once the user agrees to drop their edits: close, or load the new version.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const script = draft ?? seen?.script ?? "";
  const edited = draft !== null && draft !== (seen?.script ?? "");
  // Approval compares trimmed text, as `save` stores it.
  const differs = script.trim() !== (seen?.script ?? "");
  const tooLong = script.length > MAX_WORKTREE_SETUP_SCRIPT_LENGTH;
  const version = (setup: Setup | null) => (setup ? `${setup._id}@${setup.revision}` : null);
  const changedUnderReader = version(seen) !== version(row.setup);
  const removedUnderReader = seen !== null && row.setup === null;
  const canSave =
    canEdit && !isSaving && !changedUnderReader && !tooLong && draft !== null && draft.trim() !== "" && draft.trim() !== row.setup?.script;
  const needsApproval = seen !== null && row.setup !== null && row.setup.approval !== "approved";
  const canApprove = needsApproval && !isSaving && !isRetrying && !changedUnderReader && !differs;

  const guardDiscard = (action: () => void) => (edited ? setPendingDiscard(() => action) : action());
  const showNewVersion = () => {
    setSeen(row.setup);
    setDraft(null);
    textareaRef.current?.focus();
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await save({ projectId, repoKey: row.repoKey, script, expected: seen ? { setupId: seen._id, revision: seen.revision } : null });
      onClose();
    } catch (error) {
      toast.error(getMutationErrorMessage(error, "Failed to save the setup script"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!seen) return;
    setIsSaving(true);
    try {
      await approve({ setupId: seen._id, revision: seen.revision });
    } catch (error) {
      toast.error(getMutationErrorMessage(error, "Failed to approve the setup script"));
      return;
    } finally {
      setIsSaving(false);
    }
    onClose();
    await onRetry?.(true);
  };

  const approveButton = (inFooter: boolean) => (
    <Button
      type="button"
      size={inFooter ? "default" : "sm"}
      className={inFooter ? "cursor-pointer" : "shrink-0 cursor-pointer self-start sm:self-auto"}
      disabled={!canApprove}
      onClick={() => void handleApprove()}
    >
      {onRetry ? "Approve and retry" : "Approve"}
    </Button>
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && guardDiscard(onClose)}>
        <DialogContent
          className="flex max-h-[85dvh] flex-col sm:max-w-2xl"
          // Cancelling the pointerdown keeps the page from taking focus from the Discard confirm it opens.
          onPointerDownOutside={(event) => {
            if (edited) event.detail.originalEvent.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onFocusRow(row.repoKey);
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-mono">{row.repoKey}</DialogTitle>
            <DialogDescription>
              Bash that runs once in every new worktree a CLI creates for this repo, before the agent starts. Each teammate&apos;s
              CLIs run it only after they approve the current version.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            {/* Long scripts scroll here, so the footer stays on screen. Padding keeps focus rings inside. */}
            <div data-testid="worktree-setup-dialog-body" className="-mx-1 min-h-0 space-y-4 overflow-y-auto px-1 py-1">
              {changedUnderReader && row.setup ? (
                <div role="status" className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span className="text-warning">{editorName(row.setup)} changed the script. Review the new version.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 cursor-pointer"
                    onClick={() => guardDiscard(showNewVersion)}
                  >
                    Show new version
                  </Button>
                </div>
              ) : null}
              {removedUnderReader ? (
                <div role="status" className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span className="text-warning">This script was removed. Saving adds it again.</span>
                  <Button type="button" size="sm" variant="outline" className="shrink-0 cursor-pointer" onClick={() => setSeen(null)}>
                    {draft !== null ? "Keep my edits" : "Start over"}
                  </Button>
                </div>
              ) : null}
              {needsApproval && seen && seen.approval !== "approved" ? (
                <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex flex-col gap-0.5">
                    <span>{APPROVAL_PROMPTS[seen.approval](editorName(seen))}</span>
                    {differs ? <span className="text-xs text-muted-foreground">Save approves your edited version.</span> : null}
                  </span>
                  {/* A reader acts after the script, in the footer; an editor approves beside the prompt. */}
                  {canEdit ? approveButton(false) : null}
                </div>
              ) : null}
              {!canEdit && !seen ? (
                <p className="text-sm text-muted-foreground">No setup script is saved for this repo.</p>
              ) : (
              <div className="space-y-1">
                <Textarea
                  ref={textareaRef}
                  aria-label="Setup script"
                  aria-invalid={tooLong}
                  aria-describedby={script.length >= LENGTH_HINT_FROM ? "worktree-setup-length" : undefined}
                  value={script}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={EXAMPLE_SCRIPT}
                  readOnly={!canEdit}
                  // Read-only text is for checking: no soft wrap, so a wrapped path never reads as its own command.
                  wrap={canEdit ? undefined : "off"}
                  rows={12}
                  spellCheck={false}
                  className={cn("field-sizing-fixed max-h-[50dvh] resize-y overflow-auto font-mono text-xs", !canEdit && "bg-muted/30 dark:bg-muted/30")}
                  // A reader starts on the script, so Enter cannot approve it unread.
                  autoFocus={!canEdit || !needsApproval}
                />
                {script.length >= LENGTH_HINT_FROM ? (
                  <p id="worktree-setup-length" className={cn("text-right text-xs tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>
                    {lengthHint(script.length)}
                  </p>
                ) : null}
              </div>
              )}
              {seen ? (
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{lastEdited(seen)}</span>
                  {row.setup?.approval === "approved" && !changedUnderReader && !differs ? <span className="shrink-0">Approved by you</span> : null}
                </div>
              ) : null}
              {canEdit || seen ? (
                <dl className="space-y-1 text-xs text-muted-foreground">
                  {ENV_VARS.map(([name, meaning]) => (
                    <div key={name} className="flex flex-wrap gap-x-2">
                      <dt className="font-mono text-foreground">{name}</dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="cursor-pointer" onClick={() => guardDiscard(onClose)}>
                {canEdit ? "Cancel" : "Close"}
              </Button>
              {canEdit ? (
                <Button type="submit" className="cursor-pointer" disabled={!canSave}>
                  Save
                </Button>
              ) : needsApproval ? (
                approveButton(true)
              ) : onRetry ? (
                <Button
                  type="button"
                  className="cursor-pointer"
                  disabled={changedUnderReader || isRetrying}
                  onClick={() => {
                    onClose();
                    void onRetry(false);
                  }}
                >
                  Retry
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={pendingDiscard !== null} onOpenChange={(open) => !open && setPendingDiscard(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // The editor is still open unless Discard closed it; then its own close focuses the row.
            event.preventDefault();
            if (textareaRef.current?.isConnected) textareaRef.current.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to the setup script will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                pendingDiscard?.();
                setPendingDiscard(null);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RemoveDialog({
  projectId,
  repoKey,
  onClose,
  onFocusRow,
}: {
  projectId: Id<"projects">;
  repoKey: string | null;
  onClose: () => void;
  onFocusRow: (repoKey: string) => void;
}) {
  const remove = useMutation(api.cli.worktreeSetups.remove);
  // Keeps the title's repo key through the exit animation, after `repoKey` is cleared.
  const [shownKey, setShownKey] = useState(repoKey);
  if (repoKey !== null && repoKey !== shownKey) setShownKey(repoKey);
  const handleRemove = async () => {
    if (!repoKey) return;
    try {
      await remove({ projectId, repoKey });
    } catch (error) {
      toast.error(getMutationErrorMessage(error, "Failed to remove the setup script"));
    }
  };
  return (
    <AlertDialog open={repoKey !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (shownKey) onFocusRow(shownKey);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove the setup for <span className="font-mono">{shownKey}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>New worktrees for this repo start without a setup script.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void handleRemove()}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
