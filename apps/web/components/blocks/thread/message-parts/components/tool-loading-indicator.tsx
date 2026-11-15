import { Spinner } from "@/components/custom/spinner";
import { cn } from "@/lib/utils";

interface ToolLoadingIndicatorProps {
  label: string;
  className?: string;
  loaderClassName?: string;
  shimmer?: boolean;
  textClassName?: string;
}

export function ToolLoadingIndicator({
  label,
  className,
  loaderClassName = "size-3.5",
  shimmer = false,
  textClassName,
}: ToolLoadingIndicatorProps) {
  if (label.length === 0) {
    return (
      <Spinner
        className={cn(loaderClassName, className)}
      />
    );
  }

  return (
    <Spinner
      className={cn("text-muted-foreground", className)}
      loaderClassName={loaderClassName}
      shimmer={shimmer}
      text={label}
      textClassName={cn("text-current", textClassName)}
      textPlacement="inline"
    />
  );
}
