import type { ReactNode } from "react";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/custom/empty-state";
import { cn } from "@/lib/utils";

interface NotFoundStateProps {
  title?: string;
  description?: string;
  /** Usually one link or button back to the owning list. */
  action?: ReactNode;
  className?: string;
}

/** Shared "not found" state for the app-level 404 page and entity editors. */
export function NotFoundState({
  title = "Page not found",
  description = "It may have been deleted, or you may not have access to it.",
  action,
  className,
}: NotFoundStateProps) {
  return (
    <EmptyState
      fill
      className={cn("min-h-80", className)}
      icon={SearchX}
      title={title}
      titleAs="h1"
      description={description}
      action={action}
    />
  );
}
