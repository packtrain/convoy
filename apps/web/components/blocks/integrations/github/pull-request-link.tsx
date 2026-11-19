"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isSameRepository, parseAttachedPullRequest, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { AppLink, appRoute, useNavigation, type RouteTarget } from "@/lib/navigation";
import { useOptionalCurrentOrgProject, type CurrentOrgProjectRoute } from "@/lib/routing/current-org-project-context";

type PullRequestLinkProps = {
  url: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  /** Inside a row that is itself a link: a `role="link"` span, since an anchor may not nest in one. */
  nestedInLink?: boolean;
  children: ReactNode;
};

/**
 * A PR link that opens Convoy's reader when the PR's repository is connected
 * to a project the viewer can read, and GitHub in a new tab otherwise
 * (docs/specs/github-integration.md#pr-reader-and-existing-links).
 */
export function PullRequestLink(props: PullRequestLinkProps) {
  const route = useOptionalCurrentOrgProject();
  const pullRequest = route ? parseAttachedPullRequest(props.url) : null;
  return route && pullRequest ? (
    <ConnectedPullRequestLink {...props} route={route} pullRequest={pullRequest} />
  ) : (
    <ExternalPullRequestLink {...props} />
  );
}

function ConnectedPullRequestLink({
  route,
  pullRequest,
  ...props
}: PullRequestLinkProps & { route: CurrentOrgProjectRoute; pullRequest: AttachedPullRequest }) {
  const { isAuthenticated } = useAppConvexAuth();
  // One subscription per organization, shared by every PR link on screen.
  const targets = useQuery(api.integrations.github.core.listLinkTargets, isAuthenticated ? { organizationId: route.organizationId } : "skip");
  const matches = (targets ?? []).filter((target) => isSameRepository(target, pullRequest));
  // Prefer the project the viewer is in when several connect the repository.
  const target = matches.find((candidate) => candidate.projectAlias === route.projectAlias) ?? matches[0];
  if (!target) {
    return <ExternalPullRequestLink {...props} />;
  }
  const href = appRoute.projectPullRequest(route.organizationSlug, target.projectAlias, target.repositoryId, pullRequest.number);
  return <InternalPullRequestLink {...props} href={href} />;
}

function InternalPullRequestLink({ href, nestedInLink, children, ...rest }: PullRequestLinkProps & { href: RouteTarget }) {
  const navigation = useNavigation();
  if (!nestedInLink) {
    return (
      <AppLink href={href} className={rest.className} title={rest.title} aria-label={rest["aria-label"]}>
        {children}
      </AppLink>
    );
  }
  return (
    <NestedLink {...rest} onOpen={() => navigation.push(href)}>
      {children}
    </NestedLink>
  );
}

function ExternalPullRequestLink({ url, nestedInLink, children, ...rest }: PullRequestLinkProps) {
  if (!nestedInLink) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={rest.className} title={rest.title} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  }
  return (
    <NestedLink {...rest} onOpen={() => window.open(url, "_blank", "noopener,noreferrer")}>
      {children}
    </NestedLink>
  );
}

function NestedLink({
  onOpen,
  children,
  className,
  title,
  "aria-label": ariaLabel,
}: Omit<PullRequestLinkProps, "url" | "nestedInLink"> & { onOpen: () => void }) {
  return (
    <span
      role="link"
      tabIndex={0}
      title={title}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      {children}
    </span>
  );
}
