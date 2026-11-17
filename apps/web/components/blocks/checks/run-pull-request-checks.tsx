"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTitleBar } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { runChecksPrompt } from "./run-checks-menu";
import type { TaskCheck, TaskChecks } from "./types";

type Target = { projectId: Id<"projects">; organizationSlug: string; projectAlias: string; pullRequest: AttachedPullRequest };

/**
 * Run checks on a PR page: a thread composer prefilled with the checks prompt, on the member's own profile.
 * Hidden without the CLI thread permission. Spec: docs/specs/github-integration.md → Pull request checks.
 */
export function RunPullRequestChecksButton({ data, ...target }: Target & { data: TaskChecks }) {
  const [open, setOpen] = useState(false);
  const permissions = useProjectPermissions(target.projectId);
  const { profiles, isLoading } = useCliProfiles(target.projectId);
  // The popup's draft is per member, so its key waits for the viewer.
  const viewer = useQuery(api.users.core.current);
  if (!permissions.canUseThreads) return null;
  const checks = data.checks.filter((check) => !check.added);
  const headSha = data.pullRequest?.headSha;
  const reason =
    checks.length === 0
      ? "The Pull request checklist has no checks"
      : !headSha
        ? "Convoy has not synced this pull request yet"
        : !isLoading && !profiles.some((profile) => profile.isOnline)
          ? "No CLI profile is online"
          : null;
  return (
    <>
      {/* A disabled button gets no pointer events, so the reason sits on its wrapper. */}
      <span title={reason ?? undefined}>
        <Button size="xs" variant="ghost" disabled={isLoading || !viewer || reason !== null} onClick={() => setOpen(true)}>
          <ListChecks /> Run checks
        </Button>
      </span>
      {open && viewer && headSha ? (
        <LaunchDialog {...target} viewerId={viewer._id} data={data} checks={checks} headSha={headSha} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function LaunchDialog({
  viewerId,
  data,
  checks,
  headSha,
  onClose,
  ...target
}: Target & { viewerId: Id<"users">; data: TaskChecks; checks: TaskCheck[]; headSha: string; onClose: () => void }) {
  const navigation = useNavigation();
  // Seeded on each open: the prompt names the current head, so last time's text would be stale.
  const [seed, setSeed] = useState<string | undefined>(() => runChecksPrompt(null, data, checks, "all", "pull request", headSha));
  const { organizationSlug, projectAlias, pullRequest } = target;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Radix would focus the profile pill, which opens its card; the composer focuses itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitleBar>
          <DialogTitle className="text-sm">Run pull request checks</DialogTitle>
          <DialogDescription className="sr-only">Start a thread that checks this pull request.</DialogDescription>
        </DialogTitleBar>
        <TaskThreadComposer
          {...target}
          draftKey={`pull-request-checks:${viewerId}`}
          pullRequestChecks={{ headSha }}
          seed={seed}
          seedReplacesDraft
          onSeeded={() => setSeed(undefined)}
          autoFocus
          composerContainerClassName="p-3"
          onThreadCreated={(threadId) => {
            toast.success(`Started ${checks.length} ${checks.length === 1 ? "check" : "checks"} on #${pullRequest.number}`, {
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
