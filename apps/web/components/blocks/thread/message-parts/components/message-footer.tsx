import { forwardRef, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// MessageFooterTrigger
// ---------------------------------------------------------------------------

interface MessageFooterTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export const MessageFooterTrigger = forwardRef<
  HTMLButtonElement,
  MessageFooterTriggerProps
>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
MessageFooterTrigger.displayName = "MessageFooterTrigger";

// ---------------------------------------------------------------------------
// MessageFooterPopover
// ---------------------------------------------------------------------------

interface MessageFooterPopoverProps {
  trigger: ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  children: ReactNode;
}

export function MessageFooterPopover({
  trigger,
  align = "start",
  contentClassName,
  children,
}: MessageFooterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "w-64 max-h-[min(75dvh,var(--radix-popover-content-available-height))] overflow-auto p-0",
          contentClassName,
        )}
      >
        <div className="divide-y divide-border text-xs">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// MessageFooterRow
// ---------------------------------------------------------------------------

interface MessageFooterRowProps {
  label: string;
  value: string;
  icon?: ComponentType<{ className?: string }>;
  truncate?: boolean;
}

export function MessageFooterRow({
  label,
  value,
  icon: Icon,
  truncate = false,
}: MessageFooterRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2",
        truncate && "gap-4",
      )}
    >
      <span className={cn("text-muted-foreground", truncate && "shrink-0")}>
        {label}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 font-medium text-foreground",
          truncate && "truncate",
        )}
        title={value}
      >
        {Icon && <Icon className={cn("size-3", truncate && "shrink-0")} />}
        <span className={truncate ? "truncate" : undefined}>{value}</span>
      </span>
    </div>
  );
}
