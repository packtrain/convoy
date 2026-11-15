import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type CenteredVariant = "screen" | "fill" | "fill-min";

const centeredVariants: Record<CenteredVariant, string> = {
  screen: "flex min-h-screen items-center justify-center",
  fill: "flex flex-1 items-center justify-center",
  "fill-min": "flex min-h-0 flex-1 items-center justify-center",
};

interface CenteredProps extends ComponentPropsWithoutRef<"div"> {
  as?: "div" | "main";
  variant?: CenteredVariant;
}

export function Centered({
  as: Comp = "div",
  variant = "fill",
  className,
  ...props
}: CenteredProps) {
  return (
    <Comp
      className={cn(centeredVariants[variant], className)}
      {...props}
    />
  );
}
