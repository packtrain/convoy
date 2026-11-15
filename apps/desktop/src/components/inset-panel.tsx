import { cn } from "@/lib/utils";

/** Recessed detail panel (sign-in instructions, failure output) inside a row/card. */
export function InsetPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border border-border bg-code px-3.5 py-3 text-left", className)}>
      {children}
    </div>
  );
}
