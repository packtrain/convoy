"use client";

import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DANGER_CALLOUT_ACTION_CLASS, DangerCallout } from "@/components/custom/danger-callout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getMutationErrorMessage } from "@/lib/errors";
import { ScriptDialog } from "./worktree-setups-settings-section";

/**
 * A run blocked on an unapproved setup script: read it in place, then Approve and retry.
 * Spec: docs/specs/cli-worktrees.md#approve-from-the-blocked-thread-os-2584.
 */
export function WorktreeSetupBlockedCallout({
  projectId,
  repoKey,
  onRetry,
  onRetryWithoutConfirm,
  isRetrying,
}: {
  projectId: Id<"projects">;
  repoKey: string;
  onRetry: () => void;
  onRetryWithoutConfirm: () => Promise<void>;
  isRetrying: boolean;
}) {
  const [reviewing, setReviewing] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  // Subscribed only while reviewing; the dialog pins the version it first renders.
  const rows = useQuery(api.cli.worktreeSetups.list, reviewing ? { projectId } : "skip");
  const loading = reviewing && rows === undefined;
  return (
    <>
      <DangerCallout
        title="Run stopped for setup script approval"
        description={
          <>
            The setup script for <code className="font-mono">{repoKey}</code> wasn&apos;t approved when this run started,
            so no worktree was created.
          </>
        }
        actions={
          <>
            {/* For a script approved elsewhere since the run failed. */}
            <Button variant="outline" size="sm" disabled={isRetrying} onClick={onRetry}>
              <RotateCcw className="mr-1.5 size-3" />
              Retry
            </Button>
            <Button
              ref={reviewButton}
              size="sm"
              className={DANGER_CALLOUT_ACTION_CLASS}
              disabled={loading}
              aria-busy={loading}
              onClick={() => setReviewing(true)}
            >
              Review script
            </Button>
          </>
        }
      />
      {reviewing && rows ? (
        <ScriptDialog
          projectId={projectId}
          row={rows.find((row) => row.repoKey === repoKey) ?? { repoKey, setup: null }}
          canEdit={false}
          isRetrying={isRetrying}
          onClose={() => setReviewing(false)}
          onFocusRow={() => reviewButton.current?.focus()}
          onRetry={async (approvedNow) => {
            try {
              await onRetryWithoutConfirm();
            } catch (error) {
              toast.error(approvedNow ? "Approved, but the retry failed" : "Couldn't retry the run", {
                description: getMutationErrorMessage(error, "Press Retry to try again."),
              });
            }
          }}
        />
      ) : null}
    </>
  );
}
