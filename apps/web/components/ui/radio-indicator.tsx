import { cn } from "@/lib/utils";

/** Paints the dot for an `sr-only` native radio (the app has no Radix radio); matches Checkbox. */
export function RadioIndicator({ checked, disabled, className }: { checked: boolean; disabled?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary" : "border-input dark:bg-input/30",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {checked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
    </span>
  );
}
