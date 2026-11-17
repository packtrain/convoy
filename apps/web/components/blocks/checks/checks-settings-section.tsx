"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Ellipsis, ListChecks, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { showConvexErrorToast } from "@/lib/errors";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { CheckDialog } from "./check-dialog";
import { ChecklistDialog, DefaultsDialog, PullRequestsPill } from "./checklist-dialog";
import type { CheckDefinition, Checklist } from "./types";

type Editing = { kind: "check"; check?: CheckDefinition } | { kind: "checklist"; checklist?: Checklist } | { kind: "defaults" };
type Deleting = { kind: "check"; check: CheckDefinition } | { kind: "checklist"; checklist: Checklist };

/** Project settings → Checks: the check catalog and the Checklists built from it (docs/specs/task-checks.md). */
export function ChecksSettingsSection({
  projectId,
  canEdit,
  publishPullRequestChecks = true,
}: {
  projectId: Id<"projects"> | null;
  canEdit: boolean;
  /** The project's setting; unset means on. */
  publishPullRequestChecks?: boolean;
}) {
  const catalog = useQuery(api.checks.definitions.list, projectId ? { projectId } : "skip");
  const checklists = useQuery(api.checks.checklists.list, projectId ? { projectId } : "skip");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  if (!projectId || catalog === undefined || checklists === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  const labels = new Map(catalog.map((check) => [check.key, check.label]));

  return (
    <div className="space-y-8">
      {!canEdit ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Only project admins can manage checks.
        </div>
      ) : null}

      {/* An empty catalog with no Checklists is the whole page, so it needs no group heading. */}
      <CatalogGroup
        title={catalog.length > 0 || checklists.length > 0 ? "Checks" : undefined}
        createLabel="Create check"
        onCreate={canEdit && catalog.length > 0 ? () => setEditing({ kind: "check" }) : undefined}
      >
        {catalog.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No checks yet"
            description="A check is a claim an agent proves with evidence, like “All tests pass”."
            action={
              canEdit ? (
                <Button type="button" variant="secondary" className="cursor-pointer" onClick={() => setEditing({ kind: "check" })}>
                  <Plus /> Create check
                </Button>
              ) : null
            }
          />
        ) : (
          <SettingsCatalogListFrame>
            {catalog.map((check) => (
              <CatalogRow
                key={check._id}
                name={check.label}
                badges={
                  <Badge variant="outline" className="shrink-0 font-mono text-xs">
                    {check.key}
                  </Badge>
                }
                detail={check.instruction || "No instruction"}
                onEdit={canEdit ? () => setEditing({ kind: "check", check }) : undefined}
                onDelete={canEdit ? () => setDeleting({ kind: "check", check }) : undefined}
              />
            ))}
          </SettingsCatalogListFrame>
        )}
      </CatalogGroup>

      {/* A checklist groups checks, so the group waits for the first check (docs/specs/task-checks.md). */}
      {catalog.length > 0 || checklists.length > 0 ? (
        <CatalogGroup
          title="Checklists"
          createLabel="Create checklist"
          onCreate={canEdit && checklists.length > 0 ? () => setEditing({ kind: "checklist" }) : undefined}
          action={
            canEdit && checklists.length > 0 ? (
              <Button type="button" variant="outline" size="settings" className="cursor-pointer" onClick={() => setEditing({ kind: "defaults" })}>
                Defaults
              </Button>
            ) : null
          }
        >
          {checklists.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No checklists yet"
              description="Group checks into a checklist, then pick it under Defaults for a task type or for pull requests."
              action={
                canEdit ? (
                  <Button type="button" variant="secondary" className="cursor-pointer" onClick={() => setEditing({ kind: "checklist" })}>
                    <Plus /> Create checklist
                  </Button>
                ) : null
              }
            />
          ) : (
            <SettingsCatalogListFrame>
              {checklists.map((checklist) => (
                <CatalogRow
                  key={checklist._id}
                  name={checklist.name}
                  badges={
                    <>
                      {checklist.taskTypeKeys.map((typeKey) => {
                        const type = resolveTaskTypeSummary(typeKey);
                        return (
                          <DefaultsPillButton key={typeKey} name={type.name} onClick={canEdit ? () => setEditing({ kind: "defaults" }) : undefined}>
                            <TaskType taskType={type} />
                          </DefaultsPillButton>
                        );
                      })}
                      {checklist.pullRequests ? (
                        <DefaultsPillButton name="Pull requests" onClick={canEdit ? () => setEditing({ kind: "defaults" }) : undefined}>
                          <PullRequestsPill />
                        </DefaultsPillButton>
                      ) : null}
                    </>
                  }
                  detail={checklist.checkKeys.map((key) => labels.get(key) ?? key).join(" · ") || "No checks"}
                  onEdit={canEdit ? () => setEditing({ kind: "checklist", checklist }) : undefined}
                  onDelete={canEdit ? () => setDeleting({ kind: "checklist", checklist }) : undefined}
                />
              ))}
            </SettingsCatalogListFrame>
          )}
        </CatalogGroup>
      ) : null}

      {checklists.some((checklist) => checklist.pullRequests) ? (
        <CatalogGroup title="Pull requests" createLabel="">
          <PublishSwitch projectId={projectId} checked={publishPullRequestChecks} canEdit={canEdit} />
        </CatalogGroup>
      ) : null}

      {editing?.kind === "check" ? <CheckDialog projectId={projectId} check={editing.check} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "checklist" ? (
        <ChecklistDialog
          projectId={projectId}
          checklist={editing.checklist}
          catalog={catalog}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "defaults" ? <DefaultsDialog projectId={projectId} checklists={checklists} onClose={() => setEditing(null)} /> : null}
      <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CatalogGroup({
  title,
  createLabel,
  onCreate,
  action,
  children,
}: {
  title?: string;
  createLabel: string;
  onCreate?: () => void;
  /** Shown before the create button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <div className="flex items-center gap-2">
            {action}
            {onCreate ? (
              <Button type="button" variant="outline" size="settings" className="cursor-pointer" onClick={onCreate}>
                <Plus /> {createLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function CatalogRow({
  name,
  badges,
  detail,
  onEdit,
  onDelete,
}: {
  name: string;
  badges: ReactNode;
  detail: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const content = (
    <div className="min-w-0 flex-1 space-y-1">
      {/* Badges wrap under the name, so many task-type defaults never squeeze it out. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="max-w-full truncate text-sm font-medium">{name}</span>
        {badges}
      </div>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
  return (
    // The edit button covers the row, so badge buttons can sit on top without nesting inside it.
    <div className="relative flex items-stretch transition-colors hover:bg-muted/50">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
          className="absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        />
      ) : null}
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center p-4 text-left">{content}</div>
      {onEdit && onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={`${name} actions`}
              className="relative my-auto mr-4 shrink-0 text-muted-foreground"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** Whether Pull request check results leave Convoy, on every Git host (docs/specs/github-integration.md → Pull request checks). */
function PublishSwitch({ projectId, checked, canEdit }: { projectId: Id<"projects">; checked: boolean; canEdit: boolean }) {
  const update = useMutation(api.projects.core.update);
  const [isSaving, setIsSaving] = useState(false);
  const handleChange = async (publishPullRequestChecks: boolean) => {
    setIsSaving(true);
    try {
      await update({ id: projectId, publishPullRequestChecks });
    } catch (error) {
      showConvexErrorToast(error, "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label>Publish results to the Git host</Label>
        <p className="text-sm text-muted-foreground">On GitHub, each Pull request check result becomes a check run on the PR&apos;s commit.</p>
      </div>
      <Switch
        aria-label="Publish results to the Git host"
        checked={checked}
        onCheckedChange={(value) => void handleChange(value)}
        disabled={!canEdit || isSaving}
        className="shrink-0 cursor-pointer"
      />
    </div>
  );
}

/** A default's pill on a Checklist row; clicking it opens Defaults. */
function DefaultsPillButton({ name, onClick, children }: { name: string; onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <span className="shrink-0">{children}</span>;
  return (
    <button
      type="button"
      aria-label={`Change the default checklist for ${name}`}
      className="pointer-events-auto shrink-0 cursor-pointer rounded-md hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DeleteDialog({ target, onClose }: { target: Deleting | null; onClose: () => void }) {
  const removeCheck = useMutation(api.checks.definitions.remove);
  const removeChecklist = useMutation(api.checks.checklists.remove);
  const name = target?.kind === "check" ? target.check.label : target?.checklist.name;

  const handleDelete = async () => {
    if (!target) return;
    try {
      if (target.kind === "check") {
        await removeCheck({ checkId: target.check._id });
      } else {
        await removeChecklist({ checklistId: target.checklist._id });
      }
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete");
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {target?.kind === "check"
              ? "The check is removed from every checklist."
              : "Tasks that picked this checklist go back to their task type's default."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
