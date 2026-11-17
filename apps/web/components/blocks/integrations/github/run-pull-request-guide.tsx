"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTitleBar } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { guidePrompt } from "./guide-prompt";

type Target = { projectId: Id<"projects">; organizationSlug: string; projectAlias: string; pullRequest: AttachedPullRequest };
/** The stored PR's revision; unset until Convoy has synced the PR. */
type Revision = { baseSha: string; headSha: string } | null;

/**
 * Generate guide: a thread composer prefilled with the guide prompt, on the member's own profile,
 * like Run checks. Spec: docs/specs/github-integration.md → Guides → Requesting and running.
 */
export function useGenerateGuide(target: Target | null, revision: Revision) {
  const [open, setOpen] = useState(false);
  const projectId = target?.projectId;
  const permissions = useProjectPermissions(projectId ?? null);
  const { profiles, isLoading } = useCliProfiles(projectId);
  // The popup's draft is per member, so its key waits for the viewer.
  const viewer = useQuery(api.users.core.current);
  const reason = !target || !revision
    ? "Convoy has not synced this pull request yet"
    : !isLoading && !profiles.some((profile) => profile.isOnline)
      ? "No CLI profile is online"
      : null;
  return {
    /** Hidden without the CLI thread permission. */
    allowed: permissions.canUseThreads,
    disabled: isLoading || !viewer || reason !== null,
    reason,
    start: () => setOpen(true),
    dialog:
      open && viewer && target && revision ? (
        <LaunchDialog
          {...target}
          viewerId={viewer._id}
          revision={revision}
          onClose={() => setOpen(false)}
        />
      ) : null,
  };
}

function LaunchDialog({
  viewerId,
  revision,
  onClose,
  ...target
}: Target & { viewerId: Id<"users">; revision: NonNullable<Revision>; onClose: () => void }) {
  const navigation = useNavigation();
  // Frozen at open: a push meanwhile must not send a new head with a prompt naming the old one, so the server rejects it.
  const [opened] = useState(revision);
  // Seeded on each open: the prompt names the current head, so last time's text would be stale.
  const [seed, setSeed] = useState<string | undefined>(() => guidePrompt({ pullRequest: target.pullRequest, ...opened }));
  const { organizationSlug, projectAlias, pullRequest } = target;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Radix would focus the profile pill, which opens its card; the composer focuses itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitleBar>
          <DialogTitle className="text-sm">Generate a guide</DialogTitle>
          <DialogDescription className="sr-only">Start a thread that writes a guide to this pull request.</DialogDescription>
        </DialogTitleBar>
        <TaskThreadComposer
          {...target}
          draftKey={`pull-request-guide:${viewerId}`}
          pullRequestGuide={{ headSha: opened.headSha }}
          seed={seed}
          seedReplacesDraft
          onSeeded={() => setSeed(undefined)}
          autoFocus
          composerContainerClassName="p-3"
          onThreadCreated={(threadId) => {
            toast.success(`Writing a guide for #${pullRequest.number}`, {
              action: {
                label: "Open thread",
                onClick: () => navigation.push(appRoute.projectThreadDetail(organizationSlug, projectAlias, threadId)),
              },
            });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
