"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Lock, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CreateTaskLabelDialog } from "@/components/blocks/tasks/create-task-label-dialog";
import { EmptyState } from "@/components/custom/empty-state";
import { SortableRankRow, useOptimisticRankReorder } from "@/components/custom/sortable-rank-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MAX_LABELS_PER_PROJECT } from "@/lib/tasks/constants";
import { useProjectLabels, type ProjectLabel } from "@/lib/tasks/hooks/use-project-labels";
import { showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";

type DeleteResolution = "clear" | "reassign" | "archiveTasks";

export function LabelsSection({ projectId, canEdit }: { projectId: Id<"projects"> | null; canEdit: boolean }) {
  const { labels, isLoading } = useProjectLabels(projectId ?? undefined);

  const reorderLabel = useMutation(api.tasks.labels.reorder);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<ProjectLabel | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<ProjectLabel | null>(null);

  const capReached = labels.length >= MAX_LABELS_PER_PROJECT;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const { orderedItems: orderedLabels, handleDragEnd } = useOptimisticRankReorder({
    items: labels,
    onReorder: (label, rank) => reorderLabel({ labelId: label._id, rank }),
    errorMessage: "Failed to reorder label",
  });

  if (!projectId || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-4/5 rounded-sm" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col space-y-6">
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Only project admins can manage labels.
        </div>
      )}

      {labels.length === 0 ? (
        <EmptyState
          fill
          icon={Tag}
          title="No labels yet"
          description="Create labels to group the Board by them."
          action={
            canEdit ? (
              <Button type="button" variant="secondary" className="cursor-pointer" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Create label
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {canEdit && (
            <div className="flex flex-col items-start gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="settings"
                className="cursor-pointer"
                disabled={capReached}
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                Create label
              </Button>
              {capReached && (
                <p className="text-xs text-muted-foreground">
                  {MAX_LABELS_PER_PROJECT} of {MAX_LABELS_PER_PROJECT} labels used. Delete a label to create another.
                </p>
              )}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={(event: DragEndEvent) => {
              const { active, over } = event;
              if (!over) return;
              void handleDragEnd(String(active.id), String(over.id));
            }}
          >
            <SortableContext items={orderedLabels.map((label) => String(label._id))} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {orderedLabels.map((label) => (
                  <SortableRankRow
                    key={label._id}
                    id={String(label._id)}
                    dragEnabled={canEdit}
                    className="flex items-center gap-1 rounded-md"
                    dragHandleLabel="Drag to reorder label"
                  >
                    <div className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label.name}</span>
                      {canEdit && (
                        <div className="ml-auto flex shrink-0 items-center gap-0.5 md:hidden md:group-hover:flex md:group-focus-within:flex">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0 cursor-pointer text-muted-foreground"
                            aria-label={`Edit ${label.name}`}
                            onClick={() => setEditingLabel(label)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${label.name}`}
                            onClick={() => setDeletingLabel(label)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </SortableRankRow>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <DeleteLabelDialog
        label={deletingLabel}
        otherLabels={labels.filter((label) => label._id !== deletingLabel?._id)}
        onClose={() => setDeletingLabel(null)}
      />
      <CreateTaskLabelDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} labelCount={labels.length} />
      {editingLabel && (
        <CreateTaskLabelDialog
          projectId={projectId}
          label={editingLabel}
          open={editingLabel !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditingLabel(null);
            }
          }}
          labelCount={labels.length}
        />
      )}
    </div>
  );
}

function DeleteLabelDialog({
  label,
  otherLabels,
  onClose,
}: {
  label: ProjectLabel | null;
  otherLabels: ProjectLabel[];
  onClose: () => void;
}) {
  const removeLabel = useMutation(api.tasks.labels.remove);
  const [resolution, setResolution] = useState<DeleteResolution>("clear");
  const [reassignToLabelId, setReassignToLabelId] = useState<Id<"projectLabels"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const canReassign = otherLabels.length > 0;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setResolution("clear");
      setReassignToLabelId(null);
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!label) return;
    if (resolution === "reassign" && !reassignToLabelId) return;
    setIsDeleting(true);
    try {
      await removeLabel({
        labelId: label._id,
        resolution,
        reassignToLabelId: resolution === "reassign" ? (reassignToLabelId ?? undefined) : undefined,
      });
      handleOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete label");
    } finally {
      setIsDeleting(false);
    }
  };

  const options: { value: DeleteResolution; title: string; description: string }[] = [
    {
      value: "clear",
      title: "Remove label from tasks",
      description: "Tasks that use this label keep everything else and just lose the label.",
    },
    ...(canReassign
      ? [
          {
            value: "reassign" as const,
            title: "Reassign to another label",
            description: "Tasks that use this label switch to the label you pick below.",
          },
        ]
      : []),
    {
      value: "archiveTasks",
      title: "Archive these tasks",
      description: "Tasks that use this label are archived (with their subtasks) and the label is removed.",
    },
  ];

  return (
    <Dialog open={label !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete label &quot;{label?.name}&quot;</DialogTitle>
          <DialogDescription>
            Deleting a label removes it permanently. Tasks may currently use this label — choose what happens to them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {options.map((option) => (
            <div
              key={option.value}
              className={cn("rounded-md border", resolution === option.value ? "border-primary bg-muted/50" : "hover:bg-muted/30")}
            >
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                <input
                  type="radio"
                  name="label-delete-resolution"
                  className="mt-0.5 cursor-pointer accent-primary"
                  checked={resolution === option.value}
                  onChange={() => setResolution(option.value)}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
              {/* The target picker lives inside the reassign option and only
                  renders while that resolution is selected. */}
              {option.value === "reassign" && resolution === "reassign" && canReassign && (
                <div className="px-3 pb-3 pl-9">
                  <Select
                    value={reassignToLabelId ?? undefined}
                    onValueChange={(value) => setReassignToLabelId(value as Id<"projectLabels">)}
                  >
                    <SelectTrigger className="w-full cursor-pointer">
                      <SelectValue placeholder="Choose a label" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherLabels.map((other) => (
                        <SelectItem key={other._id} value={other._id} className="cursor-pointer">
                          <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: other.color }} />
                            {other.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="cursor-pointer"
            disabled={isDeleting || (resolution === "reassign" && !reassignToLabelId)}
            onClick={() => void handleDelete()}
          >
            Delete label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
