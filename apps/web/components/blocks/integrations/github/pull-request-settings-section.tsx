"use client";

import { PullRequestChecksSettings } from "@/components/blocks/checks";
import { Separator } from "@/components/ui/separator";
import type { Id } from "@/convex/_generated/dataModel";
import { GuidePromptSection } from "./guide-prompt-section";

/** Project settings → Pull requests (docs/specs/github-integration.md → Pull request settings). */
export function PullRequestSettingsSection({
  projectId,
  canEdit,
  publishPullRequestChecks,
}: {
  projectId: Id<"projects"> | null;
  canEdit: boolean;
  publishPullRequestChecks: boolean;
}) {
  return (
    <div className="space-y-8">
      {canEdit ? null : (
        <div className="rounded-lg border border-info/40 bg-info-soft p-3">
          <p className="text-sm text-info-foreground">Only project admins can change pull request settings.</p>
        </div>
      )}
      <PullRequestChecksSettings projectId={projectId} canEdit={canEdit} publishPullRequestChecks={publishPullRequestChecks} />
      <Separator />
      <GuidePromptSection projectId={projectId ?? undefined} />
    </div>
  );
}
