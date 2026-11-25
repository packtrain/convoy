"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";

// Pull request watch in the thread sidebar (docs/specs/pull-request-watch.md).

/** Whether the thread watches its Attached pull request; undefined while loading or with no PR. */
export function usePullRequestWatch(threadId: Id<"cliThreads">, hasPullRequest: boolean): boolean | undefined {
  const watch = useQuery(api.integrations.github.pullRequestWatches.getForThread, hasPullRequest ? { threadId } : "skip");
  return watch === undefined ? undefined : watch !== null;
}

/** The owner's eye in the Attached pull request tab: shows the watch and toggles it. `disabledReason` blocks starting one. */
export function PullRequestWatchButton({ threadId, disabledReason }: { threadId: Id<"cliThreads">; disabledReason?: string }) {
  const watching = usePullRequestWatch(threadId, true);
  const watch = useAction(api.integrations.github.pullRequestWatches.watch);
  const unwatch = useMutation(api.integrations.github.pullRequestWatches.unwatch);
  // The state a toggle asked for: busy until the watch query shows it, so the old state doesn't flash back.
  // Scoped to its thread: the workspace keeps this button mounted across threads that share a PR.
  const [target, setTarget] = useState<{ threadId: Id<"cliThreads">; watching: boolean } | null>(null);
  const pending = target?.threadId === threadId ? target : null;
  if (pending && pending.watching === watching) setTarget(null);
  if (watching === undefined) return null;
  const busy = pending !== null;
  const blockedReason = watching ? undefined : disabledReason;
  const label = watching
    ? "Watching pull request: Convoy messages this thread about checks, conflicts, reviews, and merges. Click to stop"
    : "Watch pull request: message this thread about checks, conflicts, reviews, and merges";
  const toggle = () => {
    if (busy) return;
    // A tap shows the reason too: touch has no tooltip.
    if (blockedReason) {
      toast.info(blockedReason);
      return;
    }
    setTarget({ threadId, watching: !watching });
    const request = watching
      ? unwatch({ threadId })
      : watch({ threadId }).then(({ failingChecks }) => {
          // Saved as reported at the start, so the agent won't hear of these.
          if (failingChecks.length > 0) {
            const names = failingChecks.map((check) => check.name).join(", ");
            toast.info(`Watching. ${failingChecks.length} ${failingChecks.length === 1 ? "check already fails" : "checks already fail"}, and Convoy reports only new failures: ${names}`);
          }
        });
    void request.catch((error: unknown) => {
      setTarget((current) => (current?.threadId === threadId ? null : current));
      showConvexErrorToast(error, watching ? "Could not stop watching" : "Could not watch the pull request");
    });
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={watching}
      // aria-disabled, not disabled: a disabled button drops keyboard focus.
      aria-disabled={busy || blockedReason !== undefined}
      aria-busy={busy}
      aria-description={blockedReason}
      title={blockedReason ?? label}
      onClick={toggle}
      className={cn(
        "aria-disabled:cursor-default aria-disabled:opacity-50 aria-pressed:bg-accent",
        watching ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Eye />}
    </Button>
  );
}
