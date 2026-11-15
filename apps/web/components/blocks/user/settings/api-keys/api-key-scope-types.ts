import type { Id } from "@/convex/_generated/dataModel";

export type ApiKeyScopeInput = null | {
  organizationId: Id<"organizations">;
  projectIds: Id<"projects">[];
};

export type ApiKeyScopeProject = {
  _id: Id<"projects">;
  name: string;
  alias: string;
};

export type ApiKeyListScope =
  | { kind: "unscoped" }
  | {
      kind: "organization";
      organizationId: Id<"organizations">;
      organizationName: string;
      projectIds: Id<"projects">[];
      projects: ApiKeyScopeProject[];
      unavailableProjectCount: number;
    };

export function toApiKeyScopeInput(scope: ApiKeyListScope): ApiKeyScopeInput {
  if (scope.kind === "unscoped") {
    return null;
  }

  return {
    organizationId: scope.organizationId,
    projectIds: scope.projectIds,
  };
}

export function formatApiKeyScopeSummary(scope: ApiKeyListScope): string {
  if (scope.kind === "unscoped") {
    return "All access: all projects you can access";
  }

  if (scope.projectIds.length === 0) {
    return `${scope.organizationName}: all projects`;
  }

  if (scope.projects.length <= 2 && scope.unavailableProjectCount === 0) {
    return `${scope.organizationName}: ${scope.projects
      .map((project) => project.alias)
      .join(", ")}`;
  }

  const unavailableText =
    scope.unavailableProjectCount > 0
      ? `, ${scope.unavailableProjectCount} unavailable`
      : "";
  return `${scope.organizationName}: ${scope.projects.length} projects${unavailableText}`;
}

export function formatProjectSelectionTriggerText({
  projectIds,
  projects,
  isLoading,
}: {
  projectIds: Id<"projects">[];
  projects: ApiKeyScopeProject[];
  isLoading: boolean;
}): string {
  if (projectIds.length === 0) {
    return "All my projects";
  }

  if (isLoading) {
    return "Loading projects…";
  }

  const firstProject = projects[0];
  const firstLabel = firstProject?.alias ?? "Unavailable project";
  const additionalCount = projectIds.length - 1;

  if (additionalCount <= 0) {
    return firstLabel;
  }

  return `${firstLabel} +${additionalCount}`;
}
