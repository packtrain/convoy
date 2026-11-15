"use client";

import { useQuery } from "convex/react";
import { ChevronRight, Github } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { EmptyState } from "@/components/custom/empty-state";
import { SettingsPageHeader } from "@/components/custom/settings-layout";
import { Badge } from "@/components/ui/badge";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { useGithubIntegrationEnabled } from "@/lib/dev-mode/use-dev-mode";
import { AppLink, appRoute } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { GithubCallbackPage } from "./github/github-callback-page";
import { GithubConnection } from "./github/github-connection";
import { githubSummary, useIntegrationStatus } from "./github/use-integration-status";

type SettingsProps = { organizationSlug: string; projectAlias: string; provider?: "github" };

/**
 * Project settings → Integrations: the index, or one integration's page
 * (docs/specs/github-integration.md). `callback` is GitHub's OAuth and install redirect.
 */
type ProjectIntegrationsPageProps = SettingsProps | { callback: "github" };

export function ProjectIntegrationsPage(props: ProjectIntegrationsPageProps) {
  // The callback only finishes a flow started in settings, so the toggle does not gate it.
  return "callback" in props ? <GithubCallbackPage /> : <GatedProjectIntegrations {...props} />;
}

/** Gated by the GitHub integration developer toggle until the integration ships. */
function GatedProjectIntegrations(props: SettingsProps) {
  return useGithubIntegrationEnabled() ? (
    <ProjectIntegrations {...props} />
  ) : (
    <EmptyState fill icon={Github} title="GitHub integration is off" description="Turn it on in Settings → Developer." />
  );
}

function ProjectIntegrations({ organizationSlug, projectAlias, provider }: SettingsProps) {
  const { organizationId } = useCurrentOrgProject();
  const { isAuthenticated } = useAppConvexAuth();
  const project = useQuery(api.projects.core.getByAlias, isAuthenticated ? { organizationId, alias: projectAlias } : "skip");
  if (project === null) return null;
  return provider ? (
    <GithubIntegration projectId={project?._id} organizationSlug={organizationSlug} projectAlias={projectAlias} />
  ) : (
    <IntegrationsIndex projectId={project?._id} organizationSlug={organizationSlug} projectAlias={projectAlias} />
  );
}

type PageProps = { projectId: Id<"projects"> | undefined; organizationSlug: string; projectAlias: string };

function IntegrationsIndex({ projectId, organizationSlug, projectAlias }: PageProps) {
  const status = useIntegrationStatus(projectId);
  return (
    <SettingsCatalogListFrame>
      <AppLink
        href={appRoute.projectGithubIntegration(organizationSlug, projectAlias)}
        className="flex items-center gap-4 rounded-lg p-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Github className="size-5" aria-hidden="true" />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">GitHub</span>
          <span className="mt-1 block text-xs text-muted-foreground">Pull requests and code</span>
        </span>
        {status ? <Badge variant="outline">{githubSummary(status)}</Badge> : null}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </AppLink>
    </SettingsCatalogListFrame>
  );
}

function GithubIntegration({ projectId, organizationSlug, projectAlias }: PageProps) {
  return (
    <div className="flex flex-1 flex-col gap-8">
      <SettingsPageHeader
        title="GitHub"
        description="Browse pull requests and code from your connected repositories, right here in Convoy."
        backLink={{
          href: appRoute.projectSettings(organizationSlug, projectAlias, "integrations"),
          label: "Back to integrations",
        }}
      />
      <GithubConnection projectId={projectId} organizationSlug={organizationSlug} projectAlias={projectAlias} />
    </div>
  );
}
