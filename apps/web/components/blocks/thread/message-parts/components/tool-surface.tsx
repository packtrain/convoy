import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToolSurfaceProps {
  children: ReactNode;
  className?: string;
}

export function ToolSurface({ children, className }: ToolSurfaceProps) {
  return (
    <div
      data-slot="tool-surface"
      className={cn("rounded-md border border-border bg-muted/50 p-3", className)}
    >
      {children}
    </div>
  );
}
