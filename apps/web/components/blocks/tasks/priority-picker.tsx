"use client";

import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SearchablePicker,
  SearchablePickerItem,
  type SearchablePickerItemComponent,
} from "@/components/custom/searchable-picker";
import { PriorityIcon } from "@/components/blocks/tasks/task-table/badges";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
import { PRIORITIES } from "@/lib/tasks/constants";
import type { Priority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/** Search + priority rows. Hosts pass `itemAs` to render inside their own menu. */
export function PriorityPickerContent({
  priority,
  onSelect,
  itemAs,
}: {
  priority?: Priority;
  onSelect: (priority: Priority) => void;
  itemAs?: SearchablePickerItemComponent;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const options = PRIORITIES.filter((option) => option.toLowerCase().includes(normalizedQuery));

  return (
    <SearchablePicker
      query={query}
      onQueryChange={setQuery}
      placeholder="Search priorities..."
      clearLabel="Clear priority search"
    >
      {options.length === 0 ? (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">No priorities found</div>
      ) : (
        options.map((option) => (
          <SearchablePickerItem
            key={option}
            as={itemAs}
            data-value={option}
            checked={option === priority}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(option);
            }}
          >
            <PriorityIcon priority={option} />
            <span className="min-w-0 flex-1 truncate">{option}</span>
          </SearchablePickerItem>
        ))
      )}
    </SearchablePicker>
  );
}

interface PriorityPickerProps {
  priority?: Priority;
  onPriorityChange: (priority: Priority) => void;
  trigger: ReactNode;
  /** Controlled open state, so a shortcut can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: number;
  contentClassName?: string;
  deferMount?: boolean;
}

/** The one priority picker for table cells, the sidebar and the bulk toolbar. */
export function PriorityPicker({
  priority,
  onPriorityChange,
  trigger,
  open: controlledOpen,
  onOpenChange,
  align = "start",
  side,
  sideOffset,
  contentClassName,
  deferMount,
}: PriorityPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const fieldTriggerProps = useTaskFieldMenuTrigger({ open, onOpenChange: setOpen });

  const handleSelect = (nextPriority: Priority) => {
    onPriorityChange(nextPriority);
    // Close after the click leaves the portal subtree (same guard as StatusDropdownMenu).
    window.setTimeout(() => setOpen(false), 0);
  };

  return (
    <DropdownMenu deferMount={deferMount} modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild {...fieldTriggerProps}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn("w-48 p-0", contentClassName)}
      >
        <PriorityPickerContent priority={priority} onSelect={handleSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
