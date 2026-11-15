import type { Status } from "@/lib/tasks/types";
import { StatusIcon } from "../badges";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import { cn } from "@/lib/utils";

interface StatusCellProps {
  status: Status;
  statuses?: Status[];
  onStatusChange: (status: Status) => void;
  isEditable?: boolean;
}

/** Status icon, plus its label at the wide breakpoint (container query). */
export function StatusCell({ status, statuses, onStatusChange, isEditable = true }: StatusCellProps) {
  const content = (
    <>
      <StatusIcon status={status} className="size-4 shrink-0 @4xl:size-3.5" />
      {/* not-sr-only resets white-space and overflow, so truncate lives on the inner span. */}
      <span className="sr-only min-w-0 @4xl:not-sr-only">
        <span className="block truncate text-xs">{status}</span>
      </span>
    </>
  );
  const cellClassName = "w-full h-9 flex min-w-0 items-center justify-center gap-1.5 @4xl:justify-start @4xl:px-3";

  if (!isEditable) {
    return <div className={cellClassName} title={status}>{content}</div>;
  }

  return (
    <StatusDropdownMenu
      status={status}
      statuses={statuses}
      onStatusChange={onStatusChange}
      trigger={
        <button
          type="button"
          className={cn(cellClassName, "focus:outline-none cursor-pointer")}
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </button>
      }
      align="start"
      side="bottom"
    />
  );
}
