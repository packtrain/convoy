/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ProjectRole } from "@/lib/authz/roles";
import { withProjectRole } from "@/test-utils/project-role";
import { useSidebarTaskDrop } from "./use-sidebar-task-drop";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => Object.assign(vi.fn(), { withOptimisticUpdate: () => vi.fn() }),
}));

describe("useSidebarTaskDrop", () => {
  test.each([
    ["member", true],
    ["viewer", false],
    [undefined, false],
  ] as const)("registers drop targets for role %s: %s", (role: ProjectRole | undefined, registered) => {
    useQueryMock.mockImplementation(withProjectRole(role));
    const { result } = renderHook(() => useSidebarTaskDrop("project_1"));

    const props = result.current.getDropTargetProps({ key: "list", listRef: "SPRINT-1" });

    expect(props !== undefined).toBe(registered);
  });
});
