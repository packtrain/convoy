"use client";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { SnakeLoader } from "@/components/custom/cli-loaders";
import { cn } from "@/lib/utils";

export type SpinnerSize = "default" | "large";
export type SpinnerTextPlacement = "below" | "inline";

interface SpinnerProps {
  size?: SpinnerSize;
  text?: string;
  textPlacement?: SpinnerTextPlacement;
  shimmer?: boolean;
  className?: string;
  loaderClassName?: string;
  textClassName?: string;
}

function SpinnerLoader({ size }: { size: SpinnerSize }) {
  if (size === "large") {
    return <SnakeLoader cols={3} rows={5} size="lg" speed={1.4} />;
  }

  return <SnakeLoader cols={3} rows={4} size="sm" speed={0.8} />;
}

export function Spinner({
  size = "default",
  text,
  textPlacement = "below",
  shimmer = false,
  className,
  loaderClassName,
  textClassName,
}: SpinnerProps) {
  const loader = (
    <span
      className={cn(
        "inline-flex items-center justify-center",
        size === "default" && "size-4",
        loaderClassName
      )}
    >
      <SpinnerLoader size={size} />
    </span>
  );

  if (text) {
    const textNode = shimmer ? (
      <Shimmer
        as={textPlacement === "inline" ? "span" : "p"}
        className={cn(
          textPlacement === "inline"
            ? "text-sm text-muted-foreground"
            : "mt-4 text-sm text-muted-foreground",
          textClassName
        )}
      >
        {text}
      </Shimmer>
    ) : textPlacement === "inline" ? (
      <span className={cn("text-sm text-muted-foreground", textClassName)}>
        {text}
      </span>
    ) : (
      <p className={cn("mt-4 text-sm text-muted-foreground", textClassName)}>
        {text}
      </p>
    );

    if (textPlacement === "inline") {
      return (
        <span
          aria-live="polite"
          className={cn(
            "inline-flex items-center justify-start gap-2 text-left",
            className
          )}
          role="status"
        >
          {loader}
          {textNode}
        </span>
      );
    }

    return (
      <div
        aria-live="polite"
        className={cn("text-center", className)}
        role="status"
      >
        {loader}
        {textNode}
      </div>
    );
  }

  return (
    <span
      aria-label="Loading"
      className={cn(
        "inline-flex items-center justify-center",
        size === "default" && "size-4",
        className
      )}
      role="status"
    >
      <SpinnerLoader size={size} />
    </span>
  );
}

export default Spinner;
