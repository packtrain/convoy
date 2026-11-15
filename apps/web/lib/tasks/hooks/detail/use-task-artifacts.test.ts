/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectRole } from "@/lib/authz/roles";
import { withProjectRole } from "@/test-utils/project-role";
import { useArtifactOwningTask } from "./use-task-artifacts";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: vi.fn(),
}));

const taskId = "task_1" as Id<"tasks">;

function renderOwningTask(role: ProjectRole | null | undefined, isArchived = false) {
  const task = { _id: taskId, projectId: "project_1", isArchived };
  useQueryMock.mockImplementation(withProjectRole(role, () => task));
  return renderHook(() => useArtifactOwningTask(taskId)).result.current;
}

afterEach(() => {
  useQueryMock.mockReset();
});

describe("useArtifactOwningTask", () => {
  test("a member edits artifacts on an active task", () => {
    expect(renderOwningTask("member").isReadOnly).toBe(false);
  });

  test("an archived task stays read-only for a member", () => {
    expect(renderOwningTask("member", true).isReadOnly).toBe(true);
  });

  test("a viewer is read-only on an active task", () => {
    expect(renderOwningTask("viewer").isReadOnly).toBe(true);
  });

  test("is unresolved while the role loads", () => {
    expect(renderOwningTask(undefined).isReadOnly).toBeUndefined();
  });
});
