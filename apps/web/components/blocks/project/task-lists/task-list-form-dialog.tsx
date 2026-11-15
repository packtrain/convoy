"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { suggestTaskListRefFromName } from "@/lib/task-lists/list-ref";
import { ActionButton } from "@/components/custom/action-button";
import { ColorPicker } from "@/components/custom/color-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter, TitledDialog } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LIST_DEFAULT_VIEW_GROUPS,
  defaultViewTriggerLabel,
  parseDefaultViewValue,
  toDefaultViewValue,
  type DefaultViewValue,
} from "@/lib/task-lists/default-view-options";
import type { TaskListItem } from "./task-list-types";

export type CreatedTaskList = Pick<TaskListItem, "_id" | "name" | "ref" | "color">;

interface TaskListFormDialogProps {
  projectId: Id<"projects">;
  list?: TaskListItem | null;
  initialName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (list: CreatedTaskList) => void;
}

function normalizeSubmittedTaskListName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeSubmittedTaskListRef(ref: string): string {
  return ref.trim().toUpperCase();
}

export function TaskListFormDialog({
  projectId,
  list,
  initialName = "",
  open,
  onOpenChange,
  onCreated,
}: TaskListFormDialogProps) {
  const createList = useMutation(api.tasks.lists.create);
  const updateList = useMutation(api.tasks.lists.update);
  const { canPinLists } = useProjectPermissions(projectId);
  const isEditing = Boolean(list);
  const canManagePinState = canPinLists && !list?.isArchived;
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [defaultView, setDefaultView] = useState<DefaultViewValue>("inherit");
  const [isSaving, setIsSaving] = useState(false);
  const title = isEditing ? "Edit list" : "Create list";
  const suggestRef = (nextName: string) =>
    nextName.trim() ? suggestTaskListRefFromName(nextName) : "";

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextName = list?.name ?? initialName;
    setName(nextName);
    setRef(list?.ref ?? suggestRef(nextName));
    setColor(list?.color ?? null);
    setIsPinned(list ? (list.isPinned ?? false) : true);
    setDefaultView(toDefaultViewValue(list));
    setIsSaving(false);
  }, [initialName, list, open]);

  const canSave = useMemo(() => name.trim().length > 0 && ref.trim().length > 0, [
    name,
    ref,
  ]);

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (!isEditing) {
      setRef(suggestRef(nextName));
    }
  };

  const handleSave = async () => {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    try {
      const shouldSavePinState =
        canManagePinState &&
        (list ? isPinned !== (list.isPinned ?? false) : isPinned);
      const { defaultViewMode, defaultBoardGroupBy, defaultListGroupBy } =
        parseDefaultViewValue(defaultView);
      const defaultViewArgs = {
        ...(defaultViewMode === null ? {} : { defaultViewMode }),
        ...(defaultListGroupBy === undefined ? {} : { defaultListGroupBy }),
        ...(defaultBoardGroupBy === undefined ? {} : { defaultBoardGroupBy }),
      };
      if (list) {
        await updateList({
          id: list._id,
          name,
          ref,
          color,
          ...(shouldSavePinState ? { isPinned } : {}),
          // Only send the tri-state field when it changed, so an unrelated
          // rename never rewrites the override.
          ...(defaultView === toDefaultViewValue(list)
            ? {}
            : {
                defaultViewMode,
                ...(defaultListGroupBy === undefined ? {} : { defaultListGroupBy }),
                ...(defaultBoardGroupBy === undefined
                  ? {}
                  : { defaultBoardGroupBy }),
              }),
        });
        toast.success("List updated");
      } else {
        const createdId = await createList({
          projectId,
          name,
          ref,
          color,
          ...(shouldSavePinState ? { isPinned } : {}),
          ...defaultViewArgs,
        });
        toast.success("List created");
        onCreated?.({
          _id: createdId,
          name: normalizeSubmittedTaskListName(name),
          ref: normalizeSubmittedTaskListRef(ref),
          color: color ?? undefined,
        });
      }
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, list ? "Failed to update list" : "Failed to create list");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TitledDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      description={
        isEditing
          ? "Rename this list or change its key."
          : "Create a project list for future task grouping."
      }
      size="md"
    >
      <div className="space-y-4 pt-1">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="task-list-name">Name</Label>
            <div className="flex gap-2">
              <ColorPicker
                value={color}
                onChange={setColor}
                palette="extended"
                disabled={isSaving}
                triggerClassName="shrink-0"
              />
              <Input
                id="task-list-name"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Sprint 10"
                autoFocus
              />
            </div>
          </div>

          <div className="w-36 space-y-2">
            <Label htmlFor="task-list-ref">Key</Label>
            <Input
              id="task-list-ref"
              value={ref}
              onChange={(event) => setRef(event.target.value.toUpperCase())}
              placeholder="SPRINT-10"
              className="font-mono uppercase"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-list-default-view">Default view</Label>
          <Select
            value={defaultView}
            onValueChange={(value) => setDefaultView(value as DefaultViewValue)}
            disabled={isSaving}
          >
            <SelectTrigger
              id="task-list-default-view"
              aria-label="Default view"
              className="w-full cursor-pointer"
            >
              <SelectValue>{defaultViewTriggerLabel(defaultView)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Project default</SelectItem>
              {LIST_DEFAULT_VIEW_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            How this list opens. Project default follows the project setting.
          </p>
        </div>

        {canManagePinState ? (
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              id="task-list-is-pinned"
              checked={isPinned}
              disabled={isSaving}
              onCheckedChange={(checked) => setIsPinned(checked === true)}
            />
            <span className="grid gap-1">
              <span className="text-sm font-medium leading-none">
                Pin to sidebar
              </span>
              <span className="text-sm leading-6 text-muted-foreground">
                Show this list under the project in the sidebar.
              </span>
            </span>
          </label>
        ) : null}

        {isEditing ? (
          <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
            <p className="text-xs text-warning-foreground">
              <strong>Warning:</strong> Changing the list key will affect existing
              task references.
            </p>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <ActionButton
          type="button"
          busy={isSaving}
          disabled={!canSave}
          onClick={handleSave}
          showIcon={false}
        >
          Save
        </ActionButton>
      </DialogFooter>
    </TitledDialog>
  );
}
