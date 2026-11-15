import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ProjectAgentEmptyListMessage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-border p-4 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
