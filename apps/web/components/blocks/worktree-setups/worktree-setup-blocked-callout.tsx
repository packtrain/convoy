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
  onApproveAndRetry,
}: {
  projectId: Id<"projects">;
  repoKey: string;
  onRetry: () => void;
  onApproveAndRetry: () => Promise<void>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  // Subscribed only while reviewing; the dialog pins the version it first renders.
  const rows = useQuery(api.cli.worktreeSetups.list, reviewing ? { projectId } : "skip");
  const loading = reviewing && rows === undefined;
  return (
    <>
      <DangerCallout
        title="Setup script needs your approval"
        description={
          <>
            Review the setup script for <code className="font-mono">{repoKey}</code> before your CLI runs it in this
            thread&apos;s new worktree.
          </>
        }
        actions={
          <>
            {/* For a script approved elsewhere since the run failed. */}
            <Button variant="outline" size="sm" onClick={onRetry}>
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
          approveLabel="Approve and retry"
          onClose={() => setReviewing(false)}
          onFocusRow={() => reviewButton.current?.focus()}
          onApproved={async () => {
            try {
              await onApproveAndRetry();
            } catch (error) {
              toast.error("Approved, but the retry failed", { description: getMutationErrorMessage(error, "Press Retry to try again.") });
            }
          }}
        />
      ) : null}
    </>
  );
}
