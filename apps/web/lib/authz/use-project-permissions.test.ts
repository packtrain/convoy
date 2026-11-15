/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { withProjectRole } from "@/test-utils/project-role";
import { useProjectPermissions, VIEW_ONLY_REASON } from "./use-project-permissions";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

const projectId = "project_1" as Id<"projects">;
const organizationId = "org_1" as Id<"organizations">;

afterEach(() => {
  useQueryMock.mockReset();
});

describe("useProjectPermissions", () => {
  test("a viewer gets no task, comment, or thread writes", () => {
    useQueryMock.mockImplementation(withProjectRole("viewer"));

    const { result } = renderHook(() => useProjectPermissions(projectId));

    expect(result.current).toMatchObject({
      canCreateTask: false,
      canUpdateTask: false,
      canDeleteTask: false,
      canComment: false,
      canUseThreads: false,
      readOnlyReason: VIEW_ONLY_REASON,
      isLoading: false,
    });
  });

  test("a member is writable and has no read-only reason", () => {
    useQueryMock.mockImplementation(withProjectRole("member"));

    const { result } = renderHook(() => useProjectPermissions(projectId));

    expect(result.current).toMatchObject({
      canCreateTask: true,
      canUpdateTask: true,
      canDeleteTask: true,
      canComment: true,
      canUseThreads: true,
      readOnlyReason: null,
    });
  });

  test("while the role loads every write is unavailable", () => {
    useQueryMock.mockImplementation(withProjectRole(undefined));

    const { result } = renderHook(() => useProjectPermissions(projectId));

    expect(result.current).toMatchObject({
      canUpdateTask: false,
      canComment: false,
      readOnlyReason: VIEW_ONLY_REASON,
      isLoading: true,
    });
  });

  test("an org admin with no project row is a viewer here (OS-1536)", () => {
    useQueryMock.mockImplementation(withProjectRole(null, () => "admin"));

    const { result } = renderHook(() =>
      useProjectPermissions(projectId, organizationId)
    );

    expect(result.current.canUpdateTask).toBe(false);
    expect(result.current.readOnlyReason).toBe(VIEW_ONLY_REASON);
    // Project delete is an org permission, so the project role cannot answer it.
    expect(result.current.canDeleteProject).toBe(true);
  });

  test("skips the org role query without an organization", () => {
    useQueryMock.mockImplementation(withProjectRole("member", () => "owner"));

    const { result } = renderHook(() => useProjectPermissions(projectId));

    const orgRoleCall = useQueryMock.mock.calls.find(
      ([query]) =>
        getFunctionName(query as FunctionReference<"query">) ===
        getFunctionName(api.organizations.members.getMyRole)
    );
    expect(orgRoleCall?.[1]).toBe("skip");
    expect(result.current.canDeleteProject).toBe(false);
  });
});
