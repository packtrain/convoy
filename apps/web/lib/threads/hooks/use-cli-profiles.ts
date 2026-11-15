"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { hydrateAvailableClis } from "@/convex/lib/contracts/validators";

/**
 * The project's profiles, plus their model catalogs under `withModelCatalogs` — a
 * second subscription, so callers with no model picker opt out and pay nothing
 * (OS-1721). See `docs/specs/cli-thread-model-selection.md`.
 */
export function useCliProfiles(
  projectId: Id<"projects"> | undefined,
  options?: { withModelCatalogs?: boolean }
) {
  const profiles = useQuery(
    api.cli.profiles.listByProject,
    projectId ? { projectId } : "skip"
  );

  const catalogs = useQuery(
    api.cli.profiles.listRuntimeCatalogs,
    options?.withModelCatalogs === true && projectId ? { projectId } : "skip"
  );

  const hydratedProfiles = useMemo(() => {
    if (!catalogs?.length || !profiles) {
      return profiles ?? [];
    }
    return profiles.map((profile) => ({
      ...profile,
      availableClis: hydrateAvailableClis(profile.availableClis, catalogs, profile._id),
    }));
  }, [profiles, catalogs]);

  return {
    profiles: hydratedProfiles,
    isLoading: profiles === undefined,
    hasProfiles: (profiles?.length ?? 0) > 0,
  };
}
