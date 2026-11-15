import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "@/components/custom/spinner";
import { cn } from "@/lib/utils";

interface ThreadsLoadMoreButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoadingMore: boolean;
}

export function ThreadsLoadMoreButton({
  className,
  disabled,
  isLoadingMore,
  type = "button",
  ...props
}: ThreadsLoadMoreButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoadingMore}
      className={cn(
        "flex w-full cursor-pointer items-center justify-center gap-2 border-t border-border px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {isLoadingMore ? (
        <Spinner
          text="Loading…"
          textClassName="text-current"
          textPlacement="inline"
        />
      ) : (
        "Load more"
      )}
    </button>
  );
}
