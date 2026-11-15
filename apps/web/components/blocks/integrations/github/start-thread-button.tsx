"use client";

import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { attachedPullRequestName } from "@/convex/lib/contracts/github";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Opens the new-thread composer with this PR attached (docs/specs/github-integration.md → Pull requests in threads). */
export function StartThreadButton({
  organizationSlug,
  projectAlias,
  pullRequest,
  className,
}: {
  organizationSlug: string;
  projectAlias: string;
  pullRequest: { owner: string; name: string; number: number };
  className?: string;
}) {
  const attachedPr = attachedPullRequestName(pullRequest);
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Start thread" title="Start thread" className={cn("shrink-0", className)} asChild>
      <AppLink href={appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, { attachedPr })}>
        <MessageSquarePlus />
      </AppLink>
    </Button>
  );
}
