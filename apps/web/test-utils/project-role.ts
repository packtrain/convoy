import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { ProjectRole } from "@/lib/authz/roles";

type UseQueryImpl = (query: unknown, args?: unknown) => unknown;

/**
 * A `useQuery` mock implementation that answers `projects.members.getMyRole`
 * with `role`, skipped queries with `undefined`, and the rest with `fallback`.
 * Usage: `useQueryMock.mockImplementation(withProjectRole("viewer"))`.
 */
export function withProjectRole(
  role: ProjectRole | null | undefined,
  fallback: UseQueryImpl = () => undefined
): UseQueryImpl {
  const roleQuery = getFunctionName(api.projects.members.getMyRole);
  return (query, args) => {
    if (args === "skip") return undefined;
    return getFunctionName(query as FunctionReference<"query">) === roleQuery
      ? role
      : fallback(query, args);
  };
}
