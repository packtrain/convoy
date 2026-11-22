"use client";

import { BookOpen, ListChecks } from "lucide-react";
import type { CliThreadBackground } from "@/convex/cli/threads/lib/validators";

const BACKGROUND_BADGES: Record<CliThreadBackground, { icon: typeof BookOpen; label: string }> = {
  guide: { icon: BookOpen, label: "Guide run" },
  checks: { icon: ListChecks, label: "Checks run" },
};

/** Icon-only marker naming why a background thread exists (OS-2513). Hit-testable and labelled like `ThreadSharedRowBadge`. */
export function ThreadBackgroundRowBadge({ background }: { background: CliThreadBackground }) {
  const { icon: Icon, label } = BACKGROUND_BADGES[background];
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className="pointer-events-auto inline-flex shrink-0 items-center text-muted-foreground"
    >
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}
