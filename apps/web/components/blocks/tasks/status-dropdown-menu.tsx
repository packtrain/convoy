"use client";

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SearchablePicker,
  SearchablePickerItem,
  type SearchablePickerItemComponent,
} from "@/components/custom/searchable-picker";
import { StatusBadge, StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
import { STATUS_OPTIONS } from "@/lib/tasks/constants";
import type { Status } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/** Search + status rows. Hosts pass `itemAs` (and `Separator`) to render inside their own menu. */
export function StatusPickerContent({
  status,
  statuses = STATUS_OPTIONS,
  onSelect,
  itemAs,
  Separator = DropdownMenuSeparator,
}: {
  status?: Status;
  statuses?: Status[];
  onSelect: (status: Status) => void;
  itemAs?: SearchablePickerItemComponent;
  Separator?: ComponentType;
}) {
  const [query, setQuery] = useState("");
  const renderStatusItem = (option: Status) => (
    <SearchablePickerItem
      key={option}
      as={itemAs}
      data-value={option}
      checked={option === status}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(option);
      }}
    >
      <StatusBadge status={option} />
    </SearchablePickerItem>
  );

  const availableStatuses =
    status && !statuses.includes(status) ? [status, ...statuses] : statuses;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredStatuses = availableStatuses.filter((option) =>
    option.toLowerCase().includes(normalizedQuery)
  );
  const topStatuses = filteredStatuses.filter(
    (option) => option === "In Progress" || option === "Done"
  );
  const remainingStatuses = filteredStatuses.filter(
    (option) => option !== "In Progress" && option !== "Done"
  );

  return (
    <SearchablePicker
      query={query}
      onQueryChange={setQuery}
      placeholder="Search statuses..."
      clearLabel="Clear status search"
      listClassName="max-h-58"
    >
      {filteredStatuses.length === 0 ? (
        <div className="px-2 py-2.5 text-sm text-muted-foreground">
          No statuses found.
        </div>
      ) : (
        <>
          {topStatuses.map(renderStatusItem)}
          {topStatuses.length > 0 && remainingStatuses.length > 0 ? (
            <Separator />
          ) : null}
          {remainingStatuses.map(renderStatusItem)}
        </>
      )}
    </SearchablePicker>
  );
}

interface StatusDropdownMenuProps {
  status?: Status;
  statuses?: Status[];
  onStatusChange: (status: Status) => void;
  trigger?: ReactNode;
  variant?: "default" | "compact";
  isEditable?: boolean;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: number;
  contentClassName?: string;
  /** Controlled open state, so a shortcut can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function StatusDropdownMenu({
  status,
  statuses = STATUS_OPTIONS,
  onStatusChange,
  trigger,
  variant = "default",
  isEditable = true,
  align = "start",
  side,
  sideOffset,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
}: StatusDropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const fieldTriggerProps = useTaskFieldMenuTrigger({
    open,
    onOpenChange: handleOpenChange,
  });

  const handleStatusSelect = (nextStatus: Status) => {
    onStatusChange(nextStatus);
    // Delay close until after the current click finishes traversing the
    // Radix portal subtree. Closing synchronously can unmount the item
    // before row-level interactive guards have inspected the original target.
    window.setTimeout(() => handleOpenChange(false), 0);
  };

  const canRenderCompactTrigger = variant === "compact" && status !== undefined;
  const statusLabel = `Status: ${status}`;
  // Shared icon + accessible label for both the editable and readonly triggers
  const triggerContent = canRenderCompactTrigger ? (
    <>
      <StatusIcon status={status} className="size-4" />
      <span className="sr-only">{statusLabel}</span>
    </>
  ) : null;
  const defaultTrigger =
    trigger ??
    (triggerContent && (
      <button
        type="button"
        className="cursor-pointer text-muted-foreground hover:text-foreground"
        title={statusLabel}
        onClick={(event) => event.stopPropagation()}
      >
        {triggerContent}
      </button>
    ));
  const readonlyTrigger =
    trigger ?? (triggerContent && <span title={statusLabel}>{triggerContent}</span>);

  if (!isEditable) {
    return readonlyTrigger;
  }

  if (!defaultTrigger) {
    return null;
  }

  return (
    <DropdownMenu deferMount modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild {...fieldTriggerProps}>
        {defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn("w-48 p-0", contentClassName)}
      >
        <StatusPickerContent
          status={status}
          statuses={statuses}
          onSelect={handleStatusSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
