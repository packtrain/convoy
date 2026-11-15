"use client";

import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { Plus, Tag } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SearchablePicker,
  SearchablePickerItem,
  type SearchablePickerItemComponent,
} from "@/components/custom/searchable-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
import { Button } from "@/components/ui/button";
import { CreateTaskLabelDialog } from "@/components/blocks/tasks/create-task-label-dialog";
import type { ProjectLabelSummary } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

export function TaskLabelChip({
  label,
  className,
}: {
  /** Without `color` the chip renders name-only (no dot). */
  label: Pick<ProjectLabelSummary, "name"> & { color?: string };
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground",
        className
      )}
    >
      {label.color ? (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      ) : null}
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/**
 * Search + "No label" + project labels. Hosts pass `itemAs` to render inside
 * their own menu; `onCreate` adds the "Create new" footer.
 */
export function TaskLabelPickerContent({
  labels,
  value,
  onSelect,
  onCreate,
  itemAs,
}: {
  labels: readonly ProjectLabelSummary[];
  value: Id<"projectLabels"> | null;
  onSelect: (labelId: Id<"projectLabels"> | null) => void;
  onCreate?: (query: string) => void;
  itemAs?: SearchablePickerItemComponent;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLabels = labels.filter((label) =>
    label.name.toLowerCase().includes(normalizedQuery)
  );
  const showNoLabel = "no label".includes(normalizedQuery) || normalizedQuery === "";

  return (
    <>
      <SearchablePicker
        query={query}
        onQueryChange={setQuery}
        placeholder="Search labels..."
        clearLabel="Clear label search"
        listClassName="max-h-56"
      >
        {!showNoLabel && filteredLabels.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No labels found
          </div>
        ) : (
          <>
            {showNoLabel && (
              <SearchablePickerItem
                as={itemAs}
                checked={value === null}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(null);
                }}
              >
                <Tag className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-muted-foreground">No label</span>
              </SearchablePickerItem>
            )}
            {filteredLabels.map((label) => (
              <SearchablePickerItem
                key={label._id}
                as={itemAs}
                checked={value === label._id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(label._id);
                }}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
              </SearchablePickerItem>
            ))}
          </>
        )}
      </SearchablePicker>
      {onCreate && (
        <div className="border-t border-border p-1">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full cursor-pointer justify-start gap-2 px-2 text-sm"
            onClick={(event) => {
              event.stopPropagation();
              onCreate(query.trim());
            }}
          >
            <Plus className="size-3.5" />
            Create new
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Single-select label picker in the shared field dropdown. Labels come from
 * the shared project labels query; pass them in, never query per instance.
 */
export function TaskLabelPicker({
  projectId,
  labels,
  value,
  onChange,
  trigger,
  open: controlledOpen,
  onOpenChange,
  align = "start",
  side,
  sideOffset,
  contentClassName,
}: {
  projectId?: Id<"projects">;
  labels: readonly ProjectLabelSummary[];
  value: Id<"projectLabels"> | null;
  onChange: (labelId: Id<"projectLabels"> | null) => void;
  trigger: ReactNode;
  /** Controlled open state, so a shortcut can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: number;
  contentClassName?: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const fieldTriggerProps = useTaskFieldMenuTrigger({ open, onOpenChange: setOpen });
  const [createName, setCreateName] = useState<string | null>(null);

  const handleSelect = (labelId: Id<"projectLabels"> | null) => {
    if (labelId !== value) {
      onChange(labelId);
    }
    // Delay close until after the click finishes traversing the Radix
    // portal subtree (same guard as StatusDropdownMenu).
    window.setTimeout(() => setOpen(false), 0);
  };

  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild {...fieldTriggerProps}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={cn("w-52 overflow-hidden p-0", contentClassName)}
          onClick={(event) => event.stopPropagation()}
        >
          <TaskLabelPickerContent
            labels={labels}
            value={value}
            onSelect={handleSelect}
            onCreate={
              projectId
                ? (query) => {
                    setOpen(false);
                    setCreateName(query);
                  }
                : undefined
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {projectId && createName !== null && (
        <CreateTaskLabelDialog
          projectId={projectId}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setCreateName(null);
          }}
          initialName={createName}
          labelCount={labels.length}
          onCreated={handleSelect}
        />
      )}
    </>
  );
}
