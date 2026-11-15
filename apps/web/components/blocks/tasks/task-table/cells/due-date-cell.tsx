"use client";

import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { DATE_FORMAT } from "@/lib/tasks/constants";

interface DueDateCellProps {
  /** Due date as timestamp (milliseconds) or null */
  dueDate: number | null;
  onDueDateChange: (dueDate: number | null) => void;
  isEditable?: boolean;
}

export function DueDateCell({ dueDate, onDueDateChange, isEditable = true }: DueDateCellProps) {
  // Derive Date object directly from prop - no internal state needed
  const dateTime = dueDate ? new Date(dueDate) : undefined;

  // Handle date changes - convert Date to timestamp for storage
  // Only call onDueDateChange if the value actually changed (avoids spurious updates on mount)
  const handleSetDateTime = (newDate: Date | undefined | ((prev: Date | undefined) => Date | undefined)) => {
    const resolvedDate = typeof newDate === "function" ? newDate(dateTime) : newDate;
    const newTimestamp = resolvedDate ? resolvedDate.getTime() : null;
    // Skip if value hasn't changed
    if (newTimestamp === dueDate) return;
    onDueDateChange(newTimestamp);
  };

  return (
    <div className="w-full h-9 flex items-center" onClick={(e) => e.stopPropagation()}>
      <DateTimePicker
        disabled={!isEditable}
        dateTime={dateTime}
        setDateTime={handleSetDateTime}
        variant="ghost"
        iconPosition="left"
        popoverSide="bottom"
        popoverAlign="start"
        placeholder="—"
        mode="date"
        dateFormat={DATE_FORMAT}
        // Read-only values stay legible rather than greyed out.
        className="w-full h-9 text-xs! disabled:cursor-default disabled:bg-transparent disabled:opacity-100 dark:disabled:bg-transparent"
      />
    </div>
  );
}
