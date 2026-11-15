import { cn } from "@/lib/utils";

interface RoleBadgeProps {
  label: string;
  className?: string;
}

export function RoleBadge({ label, className }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        "text-xs text-muted-foreground bg-muted px-2 py-1 rounded-[min(var(--radius-md),12px)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
