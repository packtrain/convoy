import { describe, expect, test } from "vitest";
import { parseConvoyTaskWriterToolPart } from "./convoy-task-writer-tool";

function textBlocks(value: unknown) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

describe("parseConvoyTaskWriterToolPart", () => {
  test("create_task uses output refId for the completed summary", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__create_task",
      toolCallId: "call_1",
      state: "output-available",
      input: { name: "Fix login flow", status: "To Do" },
      output: textBlocks({
        taskId: "task_1",
        refId: "OS-1300",
        taskPath: "/acme/os?task=OS-1300",
        taskUrl: "https://app.convoy.build/acme/os?task=OS-1300",
      }),
    } as const;

    expect(parseConvoyTaskWriterToolPart(part)).toEqual({
      kind: "create_task",
      server: "convoy",
      toolCallId: "call_1",
      state: "output-available",
      action: "Created task",
      refId: "OS-1300",
      detail: "“Fix login flow”",
      taskName: "Fix login flow",
    });
  });

  test("update_task summarizes status inline and other fields as changes", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "convoy-dev.update_task",
      toolCallId: "call_2",
      state: "output-available",
      input: {
        taskId: "OS-1250",
        status: "In Progress",
        priority: "High",
        label: "RENDER-TEST-label",
        assignee: null,
        description: "long payload…",
      },
      output: textBlocks(null),
    } as const;

    const payload = parseConvoyTaskWriterToolPart(part);
    expect(payload?.action).toBe("Updated");
    expect(payload?.refId).toBe("OS-1250");
    expect(payload?.detail).toBe("→ In Progress");
    expect(payload?.status).toBe("In Progress");
    expect(payload?.priority).toBe("High");
    expect(payload?.label).toBe("RENDER-TEST-label");
    expect(payload?.changes).toEqual(["Unassigned", "Description updated"]);
  });

  test("move_task and delete_task summaries", () => {
    const moved = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__move_task",
      toolCallId: "call_3",
      state: "output-available",
      input: { taskId: "OS-1250", parentId: null },
      output: textBlocks({ taskId: "task_1", parentId: null }),
    } as const);
    expect(moved?.action).toBe("Moved");
    expect(moved?.detail).toBe("to top level");

    const deleted = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__delete_task",
      toolCallId: "call_4",
      state: "output-available",
      input: { taskId: "OS-1250", cascadeMode: "keep_children" },
      output: textBlocks(null),
    } as const);
    expect(deleted?.action).toBe("Deleted");
    expect(deleted?.detail).toBe("(keeping subtasks)");
  });

  test("move_tasks_to_list keeps refs for the body on multi-task moves", () => {
    const payload = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__move_tasks_to_list",
      toolCallId: "call_5",
      state: "output-available",
      input: { taskIds: ["OS-1", "OS-2", "OS-3"], listId: "NEXT" },
      output: textBlocks(null),
    } as const);
    expect(payload?.action).toBe("Moved");
    expect(payload?.detail).toBe("3 tasks to NEXT");
    expect(payload?.taskRefs).toEqual(["OS-1", "OS-2", "OS-3"]);
  });

  test("update_task_link distinguishes upsert and delete", () => {
    const upsert = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__update_task_link",
      toolCallId: "call_6",
      state: "output-available",
      input: {
        taskId: "OS-1269",
        op: "upsert",
        id: "commit-abc",
        link: { kind: "commit", sha: "abc123", title: "feat: thing" },
      },
      output: textBlocks({ taskId: "task_1", externalLinks: [] }),
    } as const);
    expect(upsert?.action).toBe("Updated link on");
    // The whole link input survives, so the row renders it with the same
    // icon/label helpers as the task sidebar (OS-1769).
    expect(upsert?.link).toEqual({
      kind: "commit",
      sha: "abc123",
      title: "feat: thing",
    });

    const removed = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__update_task_link",
      toolCallId: "call_7",
      state: "output-error",
      input: { taskId: "OS-1269", op: "delete", id: "commit-abc" },
      errorText: "Link not found",
    } as const);
    expect(removed?.action).toBe("Remove link from");
    expect(removed?.errorText).toBe("Link not found");
  });

  test("failed calls keep the attempted action from input", () => {
    const payload = parseConvoyTaskWriterToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__update_task",
      toolCallId: "call_8",
      state: "output-error",
      input: { taskId: "OS-999999", status: "Done" },
      errorText: "Task not found",
    } as const);
    expect(payload).toMatchObject({
      action: "Update",
      refId: "OS-999999",
      detail: "→ Done",
      errorText: "Task not found",
    });
  });

  test("returns null for other servers and missing required input", () => {
    expect(
      parseConvoyTaskWriterToolPart({
        type: "dynamic-tool",
        toolName: "jira.update_task",
        toolCallId: "call_9",
        state: "output-available",
        input: { taskId: "OS-1250", status: "Done" },
        output: textBlocks(null),
      } as const)
    ).toBeNull();

    expect(
      parseConvoyTaskWriterToolPart({
        type: "dynamic-tool",
        toolName: "mcp__convoy__create_task",
        toolCallId: "call_10",
        state: "input-available",
        input: { status: "To Do" },
      } as const)
    ).toBeNull();
  });
});
