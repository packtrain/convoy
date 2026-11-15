/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import type { TaskExternalLink } from "@/lib/tasks/external-links";
import { useMappedTasks } from "./use-task-view-state";

const baseRecord = {
  _id: "task_1" as never,
  clientId: "client_1",
  refNumber: 1,
  refId: "WEB-1",
  name: "Billing bug",
  description: null,
  taskType: { key: "task", name: "Task" } as never,
  priority: "None" as const,
  dueDate: null,
  status: "To Do" as const,
  tags: [],
  rank: "0|a:",
  parentId: null,
  createdAt: 1,
  isArchived: false,
};

describe("useMappedTasks", () => {
  // Regression (OS-760): the field-by-field mapper silently dropped
  // externalLinks, so the sidebar Links row never rendered.
  test("preserves externalLinks from the server row", () => {
    const externalLinks: TaskExternalLink[] = [
      {
        id: "commit-abcdef1",
        kind: "commit",
        sha: "abcdef1234",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const { result } = renderHook(() =>
      useMappedTasks([{ ...baseRecord, externalLinks }])
    );

    expect(result.current[0].externalLinks).toEqual(externalLinks);
  });

  test("defaults externalLinks to [] for rows without the field", () => {
    const { result } = renderHook(() => useMappedTasks([baseRecord]));

    expect(result.current[0].externalLinks).toEqual([]);
  });

  // Regression (OS-1335): same field-by-field mapper dropped delegatedToAgent,
  // so delegated tasks rendered without the agent avatar in the Assignee column.
  test("preserves delegatedToAgent from the server row and defaults it to null", () => {
    const delegatedToAgent = {
      type: "projectAgent" as const,
      projectAgentId: "agent_1" as never,
      name: "Agent 1",
      isDeleted: false,
      appearance: { color: "#f97316" },
    };

    const { result } = renderHook(() =>
      useMappedTasks([{ ...baseRecord, delegatedToAgent }, baseRecord])
    );

    expect(result.current[0].delegatedToAgent).toEqual(delegatedToAgent);
    expect(result.current[1].delegatedToAgent).toBeNull();
  });

  // Regression (OS-1004): same field-by-field mapper dropped labelId, so
  // labeled tasks bucketed into the Board's "No label" column.
  test("preserves labelId from the server row and defaults it to null", () => {
    const labelId = "label_1" as never;

    const { result } = renderHook(() =>
      useMappedTasks([{ ...baseRecord, labelId }, baseRecord])
    );

    expect(result.current[0].labelId).toBe(labelId);
    expect(result.current[1].labelId).toBeNull();
  });
});
