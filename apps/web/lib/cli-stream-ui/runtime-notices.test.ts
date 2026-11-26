import { describe, expect, test } from "vitest";
import type { ComposerNotice, TaskNoticeGroupPart } from "./types";
import {
  getTaskNoticeGroupKey,
  getTaskNoticeTaskId,
  isTaskPatchNotice,
  summarizeTaskNoticeGroup,
  unapprovedWorktreeSetupRepoKey,
} from "./runtime-notices";

function taskUpdatedNotice(patch: Record<string, unknown>): ComposerNotice {
  return {
    code: "claude-task-updated",
    title: "Task updated",
    message: "Task task-1 changed.",
    detailsJson: JSON.stringify({
      subtype: "task_updated",
      payload: { task_id: "task-1", patch },
    }),
  };
}

function createTaskNoticeGroupPart(
  overrides: Partial<TaskNoticeGroupPart> = {}
): TaskNoticeGroupPart {
  return {
    type: "task-notice-group",
    groupKey: "task-1::tool-1",
    parentToolUseId: "tool-1",
    notices: [],
    childToolEvents: [],
    ...overrides,
  };
}

describe("summarizeTaskNoticeGroup", () => {
  test("marks notice-only groups with input-available task tools as started", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskTool: {
          type: "dynamic-tool",
          toolName: "Task",
          toolCallId: "tool-1",
          state: "input-available",
          input: {
            description: "Explore thread image handling",
          },
        },
      })
    );

    expect(summary.title).toBe("Explore thread image handling");
    expect(summary.status).toBe("started");
  });

  test("marks task tools with output-available state as completed when no terminal notice exists", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskTool: {
          type: "dynamic-tool",
          toolName: "Task",
          toolCallId: "tool-1",
          state: "output-available",
          input: {
            description: "Explore thread image handling",
            prompt: "Find the read-state flow",
          },
          output: [{ type: "text", text: "Done." }],
        },
      })
    );

    expect(summary.prompt).toBe("Find the read-state flow");
    expect(summary.status).toBe("completed");
  });

  test("marks task tools with output-error state as failed when no terminal notice exists", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskTool: {
          type: "dynamic-tool",
          toolName: "Task",
          toolCallId: "tool-1",
          state: "output-error",
          input: {
            description: "Explore thread image handling",
          },
          errorText: "Sub-agent failed",
        },
      })
    );

    expect(summary.status).toBe("failed");
  });

  test("preserves explicit lifecycle completion state over task tool fallback state", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskTool: {
          type: "dynamic-tool",
          toolName: "Task",
          toolCallId: "tool-1",
          state: "input-available",
          input: {
            description: "Explore thread image handling",
          },
        },
        notices: [
          {
            code: "claude-system-task_notification",
            title: "Claude runtime notice",
            message: "Claude reported task_notification.",
            detailsJson: JSON.stringify({
              subtype: "task_notification",
              payload: {
                task_id: "task-1",
                tool_use_id: "tool-1",
                status: "completed",
                summary: "Explore thread image handling",
              },
            }),
          },
        ],
      })
    );

    expect(summary.status).toBe("completed");
  });

  test("reads status out of a task_updated patch (OS-1597)", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskId: "task-1",
        notices: [
          taskUpdatedNotice({ status: "running" }),
          taskUpdatedNotice({ status: "completed", end_time: 1785872870546 }),
        ],
      })
    );

    expect(summary.status).toBe("completed");
  });

  test("keeps the last status-bearing patch even when a later patch has none", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskId: "task-1",
        notices: [
          taskUpdatedNotice({ status: "completed" }),
          taskUpdatedNotice({ end_time: 1785872870546 }),
        ],
      })
    );

    expect(summary.status).toBe("completed");
  });

  test("surfaces patch error and is_backgrounded, which no other event reports", () => {
    const summary = summarizeTaskNoticeGroup(
      createTaskNoticeGroupPart({
        taskId: "task-1",
        notices: [
          taskUpdatedNotice({ is_backgrounded: true }),
          taskUpdatedNotice({ status: "failed", error: "Subagent exploded" }),
        ],
      })
    );

    expect(summary.status).toBe("failed");
    expect(summary.error).toBe("Subagent exploded");
    expect(summary.isBackgrounded).toBe(true);
  });
});

describe("task_updated correlation helpers (OS-1597)", () => {
  test("correlates on task_id even though the patch has no tool_use_id", () => {
    const notice = taskUpdatedNotice({ status: "completed" });

    expect(getTaskNoticeTaskId(notice)).toBe("task-1");
    expect(isTaskPatchNotice(notice)).toBe(true);
  });

  test("edge lifecycle events are not patch notices", () => {
    const notice: ComposerNotice = {
      code: "claude-system-task_started",
      title: "Claude runtime notice",
      message: "Claude reported task_started.",
      detailsJson: JSON.stringify({
        subtype: "task_started",
        payload: { task_id: "task-1", tool_use_id: "tool-1" },
      }),
    };

    expect(isTaskPatchNotice(notice)).toBe(false);
    expect(getTaskNoticeTaskId(notice)).toBe("task-1");
    expect(getTaskNoticeGroupKey(notice)).toBe("task-1::tool-1");
  });
});

describe("late Codex lifecycle", () => {
  test("late Codex activity cannot reopen a completed child turn", () => {
    const notice = (status: string, turnId?: string): ComposerNotice => ({
      code: "codex-subagent",
      title: "child",
      message: status,
      detailsJson: JSON.stringify({
        subtype: "codex_subagent",
        payload: { task_id: "codex:a", status, turnId, description: "/root/a" },
      }),
    });
    const notices = [notice("completed", "one"), notice("started", "one"), notice("interacted")];
    const completedStatus = summarizeTaskNoticeGroup(createTaskNoticeGroupPart({ notices })).status;
    notices.push(notice("started", "two"), notice("completed", "one"));
    expect([
      completedStatus,
      summarizeTaskNoticeGroup(createTaskNoticeGroupPart({ notices })).status,
    ]).toEqual(["completed", "started"]);
  });
});

describe("Codex terminal source precedence", () => {
  test.each(["failed", "interrupted"])("explicit %s overrides generic completion", (outcome) => {
    const notice = (status: string, turnId?: string): ComposerNotice => ({
      code: "codex-subagent",
      title: "child",
      message: status,
      detailsJson: JSON.stringify({
        subtype: "codex_subagent",
        payload: {
          task_id: "codex:a",
          status,
          turnId,
          description: "/root/a",
        },
      }),
    });
    const notices = [
      notice("started", "one"),
      notice("completed"),
      notice(outcome, "one"),
      notice("started", "one"),
      notice("completed"),
    ];
    expect(summarizeTaskNoticeGroup(createTaskNoticeGroupPart({ notices })).status).toBe(outcome);
  });
});

describe("unapprovedWorktreeSetupRepoKey (OS-2584)", () => {
  const notice = (code: string, message: string) => ({ type: "runtime-notice" as const, code, title: "Worktree setup", message });

  test("reads the backticked repo key of the CLI's unapproved-setup notice", () => {
    expect(
      unapprovedWorktreeSetupRepoKey(notice("worktree-setup-unapproved", "The setup script for `packtrain/convoy` needs your approval."))
    ).toBe("packtrain/convoy");
  });

  test("ignores other parts and a notice without a repo key", () => {
    expect(unapprovedWorktreeSetupRepoKey(notice("worktree-setup", "Running worktree setup for `packtrain/convoy`…"))).toBeNull();
    expect(unapprovedWorktreeSetupRepoKey(notice("worktree-setup-unapproved", "Needs your approval."))).toBeNull();
    expect(unapprovedWorktreeSetupRepoKey({ type: "text", text: "`packtrain/convoy`" })).toBeNull();
  });
});
