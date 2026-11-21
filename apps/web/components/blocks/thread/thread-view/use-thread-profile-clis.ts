"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { hydrateAvailableClis } from "@/convex/lib/contracts/validators";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";

/** The thread's profile and its runtimes, with model catalogs attached. */
export function useThreadProfileClis({
  projectId,
  profileId,
  readOnly,
}: {
  projectId: Id<"projects">;
  profileId: Id<"cliProfiles">;
  readOnly: boolean;
}) {
  const activeProfile = useQuery(api.cli.profiles.get, { profileId });
  // Catalogs are no longer on the profile row (OS-1721); only a composer offers
  // models, so a read-only viewer never subscribes.
  const runtimeCatalogs = useQuery(
    api.cli.profiles.listRuntimeCatalogs,
    readOnly ? "skip" : { projectId }
  );
  // The threads layout keeps this list warm, so a just-opened thread has its
  // model names before `profiles.get` answers.
  const { profiles: projectProfiles } = useCliProfiles(readOnly ? undefined : projectId, {
    withModelCatalogs: true,
  });
  const hydratedClis = useMemo(
    () =>
      activeProfile
        ? hydrateAvailableClis(activeProfile.availableClis, runtimeCatalogs ?? [], profileId)
        : undefined,
    [activeProfile, runtimeCatalogs, profileId]
  );
  return {
    activeProfile,
    activeProfileClis: hydratedClis ?? projectProfiles.find((profile) => profile._id === profileId)?.availableClis,
  };
}
