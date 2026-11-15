"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import {
  appRoute,
  href,
  projectEntryTarget,
  type RouteTarget,
} from "@/lib/navigation";
import { getLastProjectAlias } from "./last-project-storage";

export function useOrganizationBackTarget(organizationSlug: string): RouteTarget {
  const [lastProjectAlias, setLastProjectAliasState] = useState<string | null>(
    () => getLastProjectAlias(organizationSlug)
  );

  useEffect(() => {
    setLastProjectAliasState(getLastProjectAlias(organizationSlug));
  }, [organizationSlug]);

  // These mirror queries the org layout/sidebar already subscribe to, so Convex
  // dedupes them — no extra round trip in practice. We need the last project's
  // stored default view to resolve the correct entry route.
  const organization = useQuery(api.organizations.core.getBySlug, {
    slug: organizationSlug,
  });
  const projects = useQuery(
    api.projects.core.listByOrganization,
    organization ? { organizationId: organization._id } : "skip"
  );

  if (!lastProjectAlias) {
    return appRoute.organization(organizationSlug);
  }

  const lastProject = projects?.find(
    (project) => project.alias === lastProjectAlias
  );

  // Resolve the project's stored default view so back-navigation lands on the
  // same entry view the sidebar project links use (e.g. the kanban board)
  // rather than always falling back to the list route.
  if (lastProject) {
    // No `list` param means the project default List, so its own override
    // wins over the project default (OS-1566).
    return projectEntryTarget(
      href(appRoute.project(organizationSlug, lastProjectAlias)),
      lastProject,
      { list: lastProject.defaultListView ?? null }
    );
  }

  // Projects not loaded yet (or the alias no longer resolves): fall back to the
  // bare project route. It self-corrects to the default view once data loads.
  return appRoute.project(organizationSlug, lastProjectAlias);
}
