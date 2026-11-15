import { ListTodo } from "lucide-react";
import { EmptyState } from "@/components/custom/empty-state";
import { cn } from "@/lib/utils";

/** "No tasks" state for the mobile list; the desktop table shows its add row instead. */
export function TaskListEmptyState({ className }: { className?: string }) {
  return (
    <EmptyState
      className={cn("py-12", className)}
      icon={ListTodo}
      title="No tasks"
      description="Tasks you add to this list show up here."
    />
  );
}
