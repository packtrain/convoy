"use client";

import { SearchInput } from "@/components/custom/search-input";
import { cn } from "@/lib/utils";
import type { TaskListResultsController } from "./use-task-list-results";

interface TaskListSearchInputProps {
  data: TaskListResultsController;
  autoFocus?: boolean;
  className?: string;
}

export function TaskListSearchInput({
  data,
  autoFocus = false,
  className,
}: TaskListSearchInputProps) {
  return (
    <SearchInput
      value={data.query}
      onChange={(event) => data.setQuery(event.target.value)}
      placeholder="Search lists..."
      autoFocus={autoFocus}
      className={cn("min-w-0 flex-1", className)}
      clearLabel="Clear list search"
      onClear={data.resetQuery}
      showClearButton={data.query.length > 0}
    />
  );
}
