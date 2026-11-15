import { describe, expect, test } from "vitest";
import { parseConvoyArtifactToolPart } from "./convoy-artifact-tool";

function textBlocks(value: unknown) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

describe("parseConvoyArtifactToolPart", () => {
  test("create_task_artifact keeps name, task ref, and markdown content", () => {
    const payload = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__create_task_artifact",
      toolCallId: "call_1",
      state: "output-available",
      input: {
        taskId: "OS-1250",
        name: "Plan",
        content: "# Plan\n\n- step one",
        contentType: "markdown",
      },
      output: textBlocks("artifact_id_1"),
    } as const);


    expect(payload).toMatchObject({
      kind: "create_task_artifact",
      action: "Created artifact",
      artifactName: "Plan",
      artifactId: "artifact_id_1",
      taskRef: "OS-1250",
      content: "# Plan\n\n- step one",
      contentType: "markdown",
    });
  });

  test("get_task_artifact pulls name and content from the output", () => {
    const payload = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "convoy-dev.get_task_artifact",
      toolCallId: "call_2",
      state: "output-available",
      input: { artifactId: "k123abc" },
      output: textBlocks({
        _id: "k123abc",
        name: "Plan",
        fileName: "plan.md",
        content: "# Plan",
        contentType: "markdown",
        source: "agent",
      }),
    } as const);

    expect(payload).toMatchObject({
      action: "Read artifact",
      artifactName: "Plan",
      artifactId: "k123abc",
      content: "# Plan",
    });
  });

  test("list_task_artifacts maps compact name + type rows", () => {
    const payload = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__list_task_artifacts",
      toolCallId: "call_3",
      state: "output-available",
      input: { taskId: "OS-1250" },
      output: textBlocks([
        { _id: "a1", name: "Plan", contentType: "markdown" },
        { _id: "a2", name: "Preview", contentType: "html" },
        { name: "Legacy" },
      ]),
    } as const);

    expect(payload?.taskRef).toBe("OS-1250");
    expect(payload?.artifacts).toEqual([
      { id: "a1", name: "Plan", contentType: "markdown" },
      { id: "a2", name: "Preview", contentType: "html" },
      { name: "Legacy", contentType: "markdown" },
    ]);
  });

  test("replace_in_task_artifact carries old/new strings and soft failures", () => {
    const ok = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__replace_in_task_artifact",
      toolCallId: "call_4",
      state: "output-available",
      input: { artifactId: "k123abc", oldString: "foo", newString: "bar" },
      output: textBlocks({ ok: true }),
    } as const);
    expect(ok).toMatchObject({
      action: "Edited artifact",
      oldString: "foo",
      newString: "bar",
    });
    expect(ok?.replaceError).toBeUndefined();

    const failed = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__replace_in_task_artifact",
      toolCallId: "call_5",
      state: "output-available",
      input: { artifactId: "k123abc", oldString: "foo", newString: "bar" },
      output: textBlocks({
        ok: false,
        code: "old_string_not_found",
        message: "oldString not found in artifact content",
      }),
    } as const);
    expect(failed?.replaceError).toBe("oldString not found in artifact content");
  });

  test("update and delete summaries; failed calls keep the attempted action", () => {
    const updated = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__update_task_artifact",
      toolCallId: "call_6",
      state: "output-available",
      input: { artifactId: "k123abc", content: "# Updated" },
      output: textBlocks(null),
    } as const);
    expect(updated).toMatchObject({
      action: "Updated artifact",
      content: "# Updated",
    });

    const failed = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__delete_task_artifact",
      toolCallId: "call_7",
      state: "output-error",
      input: { artifactId: "k123abc" },
      errorText: "Artifact not found",
    } as const);
    expect(failed).toMatchObject({
      action: "Delete artifact",
      errorText: "Artifact not found",
    });
  });

  test("move keeps the artifact link and reports the target task", () => {
    const moved = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__move_task_artifact",
      toolCallId: "call_7b",
      state: "output-available",
      input: { artifactId: "k123abc", taskId: "OS-1711" },
      output: textBlocks(null),
    } as const);
    expect(moved).toMatchObject({
      action: "Moved artifact",
      artifactId: "k123abc",
      taskRef: "OS-1711",
    });

    const pending = parseConvoyArtifactToolPart({
      type: "dynamic-tool",
      toolName: "mcp__convoy__move_task_artifact",
      toolCallId: "call_7c",
      state: "input-available",
      input: { artifactId: "k123abc", taskId: "OS-1711" },
    } as const);
    expect(pending?.action).toBe("Move artifact");
  });

  test("returns null for other servers and unrecognized output shapes", () => {
    expect(
      parseConvoyArtifactToolPart({
        type: "dynamic-tool",
        toolName: "jira.create_task_artifact",
        toolCallId: "call_8",
        state: "output-available",
        input: { taskId: "OS-1250", name: "Plan" },
        output: textBlocks("id"),
      } as const)
    ).toBeNull();

    expect(
      parseConvoyArtifactToolPart({
        type: "dynamic-tool",
        toolName: "mcp__convoy__get_task_artifact",
        toolCallId: "call_9",
        state: "output-available",
        input: { artifactId: "k123abc" },
        output: textBlocks(null),
      } as const)
    ).toBeNull();
  });
});
