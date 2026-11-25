"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";

// Pull request watch in the thread sidebar (docs/specs/pull-request-watch.md).

/** Whether the thread watches its Attached pull request; undefined while loading or with no PR. */
export function usePullRequestWatch(threadId: Id<"cliThreads">, hasPullRequest: boolean): boolean | undefined {
  const watch = useQuery(api.integrations.github.pullRequestWatches.getForThread, hasPullRequest ? { threadId } : "skip");
  return watch === undefined ? undefined : watch !== null;
}

/** The owner's eye in the Attached pull request tab: shows the watch and toggles it. */
export function PullRequestWatchButton({ threadId }: { threadId: Id<"cliThreads"> }) {
  const watching = usePullRequestWatch(threadId, true);
  const watch = useAction(api.integrations.github.pullRequestWatches.watch);
  const unwatch = useMutation(api.integrations.github.pullRequestWatches.unwatch);
  const [busy, setBusy] = useState(false);
  if (watching === undefined) return null;
  const label = watching
    ? "Watching: Convoy messages this thread when checks fail. Click to stop"
    : "Watch: message this thread when checks fail";
  const toggle = () => {
    setBusy(true);
    const request = watching
      ? unwatch({ threadId })
      : watch({ threadId }).then(({ failingChecks }) => {
          // Saved as reported at the start, so the agent won't hear of these.
          if (failingChecks.length > 0) {
            const names = failingChecks.map((check) => check.name).join(", ");
            toast.info(`Watching. ${failingChecks.length} ${failingChecks.length === 1 ? "check already fails" : "checks already fail"}, and Convoy reports only new failures: ${names}`);
          }
        });
    void request
      .catch((error: unknown) => showConvexErrorToast(error, watching ? "Could not stop watching" : "Could not watch the pull request"))
      .finally(() => setBusy(false));
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={watching}
      title={label}
      disabled={busy}
      onClick={toggle}
      className={watching ? "text-foreground" : "text-muted-foreground"}
    >
      {watching ? <Eye /> : <EyeOff />}
    </Button>
  );
}
