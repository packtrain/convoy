"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GitPullRequest, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { SortableRankRow } from "@/components/custom/sortable-rank-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showConvexErrorToast } from "@/lib/errors";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";
import type { CheckDefinition, Checklist } from "./types";

/** The Defaults row for the project's Pull request checklist (OS-2400), after the task types. */
const PULL_REQUESTS = "pull-requests";
const NONE = "none";

/** The Pull requests default, shaped like a task type pill. */
export function PullRequestsPill({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground",
        className
      )}
    >
      <GitPullRequest className="size-3 text-muted-foreground" />
      Pull requests
      {children}
    </span>
  );
}

/** Checking appends, so a new pick lands at the end of the checklist order. */
const toggle = (keys: string[], key: string, checked: boolean) => (checked ? [...keys, key] : keys.filter((other) => other !== key));

/** Create or edit a Checklist: its name and ordered Checks. Defaults are set in `DefaultsDialog`. */
export function ChecklistDialog({
  projectId,
  checklist,
  catalog,
  onClose,
}: {
  projectId: Id<"projects">;
  /** `undefined` creates a new Checklist. */
  checklist: Checklist | undefined;
  catalog: CheckDefinition[];
  onClose: () => void;
}) {
  const createChecklist = useMutation(api.checks.checklists.create);
  const updateChecklist = useMutation(api.checks.checklists.update);
  const [name, setName] = useState(checklist?.name ?? "");
  const [checkKeys, setCheckKeys] = useState(checklist?.checkKeys ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const canSave = name.trim() !== "" && !isSaving;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const labels = new Map(catalog.map((check) => [check.key, check.label]));

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      if (checklist) {
        await updateChecklist({ checklistId: checklist._id, name, checkKeys });
      } else {
        await createChecklist({ projectId, name, checkKeys, taskTypeKeys: [] });
      }
      onClose();
    } catch (error) {
      showConvexErrorToast(error, checklist ? "Failed to update checklist" : "Failed to create checklist");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{checklist ? "Edit checklist" : "New checklist"}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          {/* Long checklists scroll here; the footer stays reachable. Padding keeps focus rings inside. */}
          <div data-testid="checklist-dialog-body" className="-mx-1 min-h-0 space-y-5 overflow-y-auto px-1 py-1">
            <div className="grid gap-2">
              <Label htmlFor="checklist-name">Name</Label>
              <Input id="checklist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Feature" autoFocus />
            </div>

            <div className="grid gap-2">
              <Label className="mb-1">Checks</Label>
              {checkKeys.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragEnd={({ active, over }) => {
                    if (!over || active.id === over.id) return;
                    setCheckKeys(arrayMove(checkKeys, checkKeys.indexOf(String(active.id)), checkKeys.indexOf(String(over.id))));
                  }}
                >
                  <SortableContext items={checkKeys} strategy={verticalListSortingStrategy}>
                    <div className="divide-y rounded-md border">
                      {checkKeys.map((key) => (
                        <SortableRankRow
                          key={key}
                          id={key}
                          dragEnabled
                          className="flex items-center gap-2 py-1 pr-1 pl-2 text-sm"
                          dragHandleLabel={`Drag to reorder ${labels.get(key) ?? key}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{labels.get(key) ?? key}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="cursor-pointer"
                            aria-label={`Remove ${labels.get(key) ?? key}`}
                            onClick={() => setCheckKeys(toggle(checkKeys, key, false))}
                          >
                            <X />
                          </Button>
                        </SortableRankRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : null}
              <CheckboxDropdown
                trigger={
                  <Button type="button" variant="outline" size="sm" className="mt-1.5 w-fit cursor-pointer" disabled={catalog.length === 0}>
                    <Plus /> Add checks
                  </Button>
                }
                options={catalog.map((check) => ({ value: check.key, label: check.label, hint: check.key }))}
                selected={checkKeys}
                onToggle={(key, checked) => setCheckKeys(toggle(checkKeys, key, checked))}
              />
            </div>

          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!canSave}>
              {checklist ? "Save" : "Create checklist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Row key → checklist id, or `NONE`. */
type Assignment = Record<string, string>;

function currentAssignment(checklists: Checklist[]): Assignment {
  const owner = (has: (checklist: Checklist) => boolean) => checklists.find(has)?._id ?? NONE;
  return {
    ...Object.fromEntries(BUILT_IN_TASK_TYPES.map((type) => [type.key, owner((checklist) => checklist.taskTypeKeys.includes(type.key))])),
    [PULL_REQUESTS]: owner((checklist) => checklist.pullRequests),
  };
}

/** Which Checklist each task type and pull requests get by default, one picker per row. */
export function DefaultsDialog({ projectId, checklists, onClose }: { projectId: Id<"projects">; checklists: Checklist[]; onClose: () => void }) {
  const setDefaults = useMutation(api.checks.checklists.setDefaults);
  const [assignment, setAssignment] = useState(() => currentAssignment(checklists));
  const [isSaving, setIsSaving] = useState(false);
  const rows = [
    ...BUILT_IN_TASK_TYPES.map((type) => ({ key: type.key, name: type.name, pill: <TaskType taskType={type} /> })),
    { key: PULL_REQUESTS, name: "Pull requests", pill: <PullRequestsPill /> },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const pick = (key: string) => (assignment[key] === NONE ? null : (assignment[key] as Id<"checklists">));
      await setDefaults({
        projectId,
        taskTypes: BUILT_IN_TASK_TYPES.map((type) => ({ key: type.key, checklistId: pick(type.key) })),
        pullRequests: pick(PULL_REQUESTS),
      });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to save defaults");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Default checklists</DialogTitle>
          <DialogDescription>Each item uses this checklist unless someone picks another one on it.</DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-md border">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-3">
              {row.pill}
              <Select value={assignment[row.key]} onValueChange={(value) => setAssignment({ ...assignment, [row.key]: value })}>
                <SelectTrigger size="sm" className="w-44 cursor-pointer" aria-label={`Checklist for ${row.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No checks</SelectItem>
                  {checklists.map((checklist) => (
                    <SelectItem key={checklist._id} value={checklist._id}>
                      {checklist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="cursor-pointer" disabled={isSaving} onClick={() => void handleSave()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Multi-select dropdown of checkbox rows, as in the API key project scope picker. */
function CheckboxDropdown({
  trigger,
  options,
  selected,
  onToggle,
}: {
  trigger: ReactNode;
  options: { value: string; label: string; hint?: string }[];
  selected: string[];
  onToggle: (value: string, checked: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {options.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Nothing to pick yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={selected.includes(option.value)} onCheckedChange={(checked) => onToggle(option.value, checked === true)} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
