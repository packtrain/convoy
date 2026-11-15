import { useState } from "react";
import { cn } from "@/lib/utils";

/** Monospace shell-command box, optionally with a copy affordance. */
export function CommandLine({
  command,
  copyable = true,
  className,
}: {
  command: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        // bg lightens instead of darkening so it reads inside bg-code panels too.
        "flex items-center justify-between gap-3 overflow-x-auto rounded-md border border-border bg-white/[0.04] px-2.5 py-2 font-mono text-xs text-foreground/80",
        className
      )}
    >
      <span className="whitespace-nowrap">{command}</span>
      {copyable ? (
        <button
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(command);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}
