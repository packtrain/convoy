"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FolderGit2, Lock } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showConvexErrorToast } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format-relative-time";

type Row = FunctionReturnType<typeof api.cli.worktreeSetups.list>[number];
type Setup = NonNullable<Row["setup"]>;

const APPROVAL_BADGES: Record<Setup["approval"], { label: string; className: string }> = {
  approved: { label: "Approved", className: "text-muted-foreground" },
  never: { label: "Needs your approval", className: "text-warning" },
  changed: { label: "Changed since you approved", className: "text-warning" },
};

function lastEdited(setup: Setup): string {
  return `Last edited by ${setup.updatedByName ?? "a former member"}, ${formatRelativeTime(setup.updatedAt)}`;
}

const EXAMPLE_SCRIPT = `cp "$CONVOY_PARENT_PATH/.mcp.json" .
cp "$CONVOY_PARENT_PATH/apps/web/.env.local" apps/web/
pnpm i`;

const ENV_VARS = [
  ["CONVOY_PARENT_PATH", "root of the checkout the worktree was created from"],
  ["CONVOY_WORKTREE_PATH", "root of the new worktree (also the working directory)"],
  ["CONVOY_BRANCH", "the worktree's branch"],
] as const;

/** Project settings → Worktrees: one setup script per repo (docs/specs/cli-worktrees.md#worktree-setup-scripts). */
export function WorktreeSetupsSettingsSection({ projectId, canEdit }: { projectId: Id<"projects"> | null; canEdit: boolean }) {
  const rows = useQuery(api.cli.worktreeSetups.list, projectId ? { projectId } : "skip");
  // A repo key, not a row snapshot: the open dialog follows the live row (a teammate's save).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = rows?.find((row) => row.repoKey === editingKey) ?? null;

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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories yet"
        description="A repository appears here once one of your CLIs connects a path with a Git origin."
      />
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
          <button
            key={row.repoKey}
            type="button"
            onClick={() => setEditingKey(row.repoKey)}
            aria-label={`${canEdit ? "Edit" : "View"} setup for ${row.repoKey}${row.setup ? `, ${APPROVAL_BADGES[row.setup.approval].label}` : ""}`}
            className="flex w-full min-w-0 cursor-pointer items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          >
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="max-w-full truncate font-mono text-sm font-medium">{row.repoKey}</span>
              <span className="max-w-full truncate text-xs text-muted-foreground">{row.setup ? lastEdited(row.setup) : "No setup script"}</span>
            </span>
            {row.setup ? (
              <Badge
                variant="outline"
                shape="rounded"
                data-testid="approval-badge"
                className={`shrink-0 ${APPROVAL_BADGES[row.setup.approval].className}`}
              >
                {APPROVAL_BADGES[row.setup.approval].label}
              </Badge>
            ) : null}
          </button>
        ))}
      </SettingsCatalogListFrame>
      {editing ? <ScriptDialog projectId={projectId} row={editing} canEdit={canEdit} onClose={() => setEditingKey(null)} /> : null}
    </div>
  );
}

function ScriptDialog({ projectId, row, canEdit, onClose }: { projectId: Id<"projects">; row: Row; canEdit: boolean; onClose: () => void }) {
  const save = useMutation(api.cli.worktreeSetups.save);
  const remove = useMutation(api.cli.worktreeSetups.remove);
  const approve = useMutation(api.cli.worktreeSetups.approve);
  // The version on screen stays pinned when a teammate saves, so Approve sends the revision the reader read.
  const [seen, setSeen] = useState(row.setup);
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const script = draft ?? seen?.script ?? "";
  const changedUnderReader = (seen?.revision ?? null) !== (row.setup?.revision ?? null);
  const canSave = canEdit && !isSaving && draft !== null && draft.trim() !== "" && draft.trim() !== row.setup?.script;
  const canApprove = seen !== null && row.setup?.approval !== "approved" && script.trim() === seen.script;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await save({ projectId, repoKey: row.repoKey, script });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to save the setup script");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!seen) return;
    setIsSaving(true);
    try {
      await approve({ setupId: seen._id, revision: seen.revision });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to approve the setup script");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!row.setup) return;
    try {
      await remove({ projectId, repoKey: row.repoKey });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to remove the setup script");
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{row.repoKey}</DialogTitle>
            <DialogDescription>
              Bash that runs once in every new worktree a CLI creates for this repo, before the agent starts.
            </DialogDescription>
          </DialogHeader>
          {changedUnderReader ? (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="text-warning">The script changed. Review the new version.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 cursor-pointer"
                onClick={() => {
                  setSeen(row.setup);
                  setDraft(null);
                }}
              >
                Show new version
              </Button>
            </div>
          ) : null}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <Textarea
              aria-label="Setup script"
              value={script}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={EXAMPLE_SCRIPT}
              readOnly={!canEdit}
              maxLength={MAX_WORKTREE_SETUP_SCRIPT_LENGTH}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              autoFocus={canEdit}
            />
            {seen ? (
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{lastEdited(seen)}</span>
                {canApprove ? (
                  <Button type="button" size="sm" className="shrink-0 cursor-pointer" disabled={isSaving} onClick={() => void handleApprove()}>
                    Approve
                  </Button>
                ) : null}
              </div>
            ) : null}
            <dl className="space-y-1 text-xs text-muted-foreground">
              {ENV_VARS.map(([name, meaning]) => (
                <div key={name} className="flex flex-wrap gap-x-2">
                  <dt className="font-mono text-foreground">{name}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
            <DialogFooter className="sm:justify-between">
              {canEdit && row.setup ? (
                <Button type="button" variant="destructive" className="cursor-pointer" onClick={() => setConfirmingRemove(true)}>
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
                  {canEdit ? "Cancel" : "Close"}
                </Button>
                {canEdit ? (
                  <Button type="submit" className="cursor-pointer" disabled={!canSave}>
                    Save
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the setup for {row.repoKey}?</AlertDialogTitle>
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
    </>
  );
}
