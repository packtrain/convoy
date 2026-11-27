/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { clearLastResolvedValueCacheForTests } from "@/hooks/react/use-last-resolved-value";
import { useWithAgentThreadWork } from "./agent-thread-work";

const queryResultMock = vi.fn();
// Each `useQueries` entry is reported as one `queryResultMock(query, args)` call.
vi.mock("convex/react", () => ({
  useQueries: (queries: Record<string, { query: unknown; args: unknown }>) =>
    Object.fromEntries(Object.entries(queries).map(([key, { query, args }]) => [key, queryResultMock(query, args)])),
}));

afterEach(() => {
  cleanup();
  queryResultMock.mockReset();
  clearLastResolvedValueCacheForTests();
});

const projectId = "project_1" as Id<"projects">;
const task = (id: string, refNumber = 1) => ({ _id: id as Id<"tasks">, refNumber });
const entry = { threadId: "thread_1", status: "streaming" };

test("asks for saved tasks in sorted order and merges their runs", () => {
  queryResultMock.mockReturnValue([{ taskId: "task_b", entries: [entry] }]);

  const { result } = renderHook(() =>
    useWithAgentThreadWork(projectId, [task("task_b"), task("temp-uuid", 0), task("task_a")])
  );

  expect(queryResultMock).toHaveBeenCalledWith(api.tasks.agentThreadWork.listByTasks, {
    projectId,
    taskIds: ["task_a", "task_b"],
  });
  expect(result.current?.map((row) => row.agentThreadWork)).toEqual([[entry], undefined, undefined]);
});

test("keeps the last runs while a changed id set loads", () => {
  queryResultMock.mockReturnValue([{ taskId: "task_a", entries: [entry] }]);
  const { result, rerender } = renderHook(({ tasks }) => useWithAgentThreadWork(projectId, tasks), {
    initialProps: { tasks: [task("task_a")] },
  });

  queryResultMock.mockReturnValue(undefined);
  rerender({ tasks: [task("task_a"), task("task_c")] });

  expect(result.current?.[0]?.agentThreadWork).toEqual([entry]);
});

test("covers every saved task, one subscription per 1000 ids", () => {
  const tasks = Array.from({ length: 1001 }, (_, index) => task(`task_${String(index).padStart(4, "0")}`));
  queryResultMock.mockImplementation((_query, args: { taskIds: string[] }) =>
    args.taskIds.includes("task_1000") ? [{ taskId: "task_1000", entries: [entry] }] : []
  );

  const { result } = renderHook(() => useWithAgentThreadWork(projectId, tasks));

  expect(queryResultMock.mock.calls.map(([, args]) => (args as { taskIds: string[] }).taskIds.length)).toEqual([1000, 1]);
  expect(result.current?.[1000]?.agentThreadWork).toEqual([entry]);
});
