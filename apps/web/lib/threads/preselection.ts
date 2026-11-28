import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";

interface ProfilePath {
  id: string;
  kind?: CliProfilePathEntry["kind"];
}

interface ProfileWithPaths {
  _id: string;
  paths: ProfilePath[];
}

interface AgentContextQuery {
  profileId?: string | null;
  pathId?: string | null;
}

export interface ResolvedAgentContext {
  profileId: string;
  pathId: string;
}

export function resolveAgentContextPreselection(
  profiles: ProfileWithPaths[],
  query: AgentContextQuery
): ResolvedAgentContext | null {
  if (!query.profileId || !query.pathId) {
    return null;
  }

  const matchingProfile = profiles.find(
    (profile) => profile._id === query.profileId
  );
  if (!matchingProfile) {
    return null;
  }

  const matchingPath = matchingProfile.paths.find(
    (path) => path.id === query.pathId
  );
  if (!matchingPath) {
    return null;
  }

  return {
    profileId: matchingProfile._id,
    pathId: matchingPath.id,
  };
}
