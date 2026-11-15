import type { Priority } from "@/lib/tasks/types";
import { PriorityPicker } from "@/components/blocks/tasks/priority-picker";
import { EmptyValue, PriorityIcon } from "../badges";
import { Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PriorityCellProps {
  /** Current priority (optional for bulk actions where no single value applies) */
  priority?: Priority;
  onPriorityChange?: (priority: Priority) => void;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Display variant */
  variant?: "cell" | "compact";
  /** Whether priority can be edited from this control */
  isEditable?: boolean;
  /** Controlled open state, so a shortcut can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Dropdown alignment */
  align?: "start" | "center" | "end";
  /** Dropdown side */
  side?: "top" | "bottom" | "left" | "right";
  /** Dropdown offset */
  sideOffset?: number;
}

/** Icon-only priority control; an empty priority shows the em dash in table cells. */
export function PriorityCell({
  priority,
  onPriorityChange,
  trigger,
  variant = "cell",
  isEditable = true,
  open,
  onOpenChange,
  align = "center",
  side = "bottom",
  sideOffset,
}: PriorityCellProps) {
  const resolvedPriority = priority ?? "None";
  const hasPriority = resolvedPriority !== "None";
  const label = `Priority: ${resolvedPriority}`;

  // Shared icon + accessible label, used by both the editable and readonly triggers
  const content = (
    <>
      {hasPriority ? (
        <PriorityIcon priority={resolvedPriority} />
      ) : variant === "compact" ? (
        <Minus className="h-4 w-4 text-muted-foreground/40" />
      ) : (
        <EmptyValue />
      )}
      <span className="sr-only">{label}</span>
    </>
  );

  const cellClassName = "w-full h-9 flex justify-center items-center";

  if (!isEditable) {
    return (
      trigger ?? (
        <span title={label} className={variant === "cell" ? cellClassName : undefined}>
          {content}
        </span>
      )
    );
  }

  const defaultTrigger = (
    <button
      type="button"
      className={cn(
        "cursor-pointer focus:outline-none",
        variant === "compact"
          ? "text-muted-foreground hover:text-foreground"
          : cellClassName
      )}
      title={label}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </button>
  );

  return (
    <PriorityPicker
      deferMount
      priority={priority}
      onPriorityChange={(nextPriority) => onPriorityChange?.(nextPriority)}
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger ?? defaultTrigger}
      align={align}
      side={side}
      sideOffset={sideOffset}
    />
  );
}
