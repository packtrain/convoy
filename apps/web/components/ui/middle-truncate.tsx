import { cn } from "@/lib/utils";

/** Truncates in the middle so a long name keeps its distinctive end visible (`feat/os-22…agent-attached`). */
export function MiddleTruncate({ text, tailLength = 15, className }: { text: string; tailLength?: number; className?: string }) {
  if (text.length <= tailLength * 2) {
    return <span className={cn("min-w-0 truncate", className)}>{text}</span>;
  }
  return (
    <span className={cn("flex min-w-0", className)}>
      <span className="min-w-0 truncate">{text.slice(0, -tailLength)}</span>
      <span className="shrink-0 whitespace-pre">{text.slice(-tailLength)}</span>
    </span>
  );
}
