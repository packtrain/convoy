"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { isSectionPermitted, type SectionId } from "./project-settings-config";

/** Which project settings sections the caller may open. Nothing gated opens while roles load. */
export function useProjectSettingsAccess(
  organizationSlug: string,
  projectAlias: string
) {
  const { isAuthenticated } = useAppConvexAuth();
  const org = useQuery(
    api.organizations.core.getBySlug,
    isAuthenticated ? { slug: organizationSlug } : "skip"
  );
  const project = useQuery(
    api.projects.core.getByAlias,
    org ? { organizationId: org._id, alias: projectAlias } : "skip"
  );
  const { myRole, orgRole } = useProjectPermissions(
    project?._id ?? null,
    org?._id ?? null
  );

  return {
    // A missing org or project has no roles to wait for.
    isLoading:
      org !== null &&
      project !== null &&
      (myRole === undefined || orgRole === undefined),
    canOpenSection: (section: SectionId) =>
      isSectionPermitted(section, myRole, orgRole),
  };
}
