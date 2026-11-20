import { describe, expect, test } from "vitest";
import { normalizeAntigravityChunk } from "./normalizeChunk";

// Shapes recorded from agy 1.5.13 for OS-2468, with `args` and duplicate content dropped as the executor does.
const update = (u: Record<string, unknown>) => ({
  type: "session/update",
  data: JSON.stringify({ sessionId: "s-1", update: u }),
});

const shell = (status: string, extra: Record<string, unknown> = {}) =>
  update({
    sessionUpdate: status === "in_progress" ? "tool_call" : "tool_call_update",
    toolCallId: "call_1",
    name: "run_command",
    status,
    kind: "execute",
    title: "ls -la && echo done",
    rawInput: { CommandLine: "ls -la && echo done", WaitMsBeforeAsync: 5000, toolSummary: "List directory and echo done" },
    ...extra,
  });

const commandOutput = (code: number, body: string) =>
  `Created At: 2026-11-20T12:38:40-08:00\nCompleted At: 2026-11-20T12:38:41-08:00\nCommand exited with code ${code}.\n\nCommand output:\n${body}`;

describe("normalizeAntigravityChunk", () => {
  test("run_command renders as a Bash terminal row with the command output only", () => {
    expect(normalizeAntigravityChunk(shell("in_progress"))).toEqual({
      kind: "tool-input",
      toolCallId: "call_1",
      toolName: "Bash",
      inputJson: JSON.stringify({ command: "ls -la && echo done", description: "List directory and echo done" }),
    });
    expect(
      normalizeAntigravityChunk(shell("completed", { rawOutput: { output: commandOutput(0, "total 0\r\ndone\r\n"), exit_code: 0 }, content: [] }))
    ).toEqual({ kind: "tool-output", toolCallId: "call_1", outputJson: JSON.stringify({ stdout: "total 0\ndone\n" }) });
  });

  test("a nonzero exit code inside a completed update is a failed command", () => {
    expect(normalizeAntigravityChunk(shell("completed", { rawOutput: { output: commandOutput(3, "oops\r\n"), exit_code: 3 } }))).toEqual({
      kind: "tool-error",
      toolCallId: "call_1",
      errorText: "Command exited with code 3.\n\noops\n",
    });
  });

  test("a command stopped by cancel is an error, and older title-only shapes still name the command", () => {
    expect(normalizeAntigravityChunk(shell("failed", { rawOutput: { output: "" }, content: [] }))).toMatchObject({
      kind: "tool-error",
      errorText: "Command did not finish.",
    });
    for (const title of ["Running npm test", "Run `npm test`?"]) {
      const event = normalizeAntigravityChunk(
        update({ sessionUpdate: "tool_call", toolCallId: "c", name: "run_command", status: "in_progress", title, rawInput: {} })
      );
      expect(event).toMatchObject({ kind: "tool-input", inputJson: JSON.stringify({ command: "npm test" }) });
    }
    const aliased = normalizeAntigravityChunk(
      update({ sessionUpdate: "tool_call", toolCallId: "c", name: "run_command", status: "in_progress", title: "x", rawInput: { command_line: "pwd" } })
    );
    expect(aliased).toMatchObject({ inputJson: JSON.stringify({ command: "pwd" }) });
  });

  test("file tools map onto Write, Edit and Read with their paths", () => {
    const file = { toolCallId: "call_2", status: "in_progress", kind: "edit", title: "File hello.txt", locations: [{ path: "/w/hello.txt" }] };
    expect(
      normalizeAntigravityChunk(update({ sessionUpdate: "tool_call", name: "write_file", ...file, rawInput: { Content: "hi\n", Overwrite: true, Path: "/w/hello.txt" } }))
    ).toMatchObject({ toolName: "Write", inputJson: JSON.stringify({ file_path: "/w/hello.txt", content: "hi\n" }) });
    expect(
      normalizeAntigravityChunk(
        update({ sessionUpdate: "tool_call", name: "edit_file", ...file, rawInput: { Path: "/w/hello.txt", Replacement: "hi there", Target: "hi" } })
      )
    ).toMatchObject({ toolName: "Edit", inputJson: JSON.stringify({ file_path: "/w/hello.txt", old_string: "hi", new_string: "hi there" }) });
    expect(
      normalizeAntigravityChunk(update({ sessionUpdate: "tool_call", name: "read_file", ...file, kind: "read", rawInput: { Path: "/w/notes.txt" } }))
    ).toMatchObject({ toolName: "Read", inputJson: JSON.stringify({ file_path: "/w/notes.txt" }) });
    expect(
      normalizeAntigravityChunk(
        update({ sessionUpdate: "tool_call_update", name: "read_file", ...file, status: "completed", rawInput: { Path: "/w/notes.txt" } })
      )
    ).toEqual({ kind: "tool-output", toolCallId: "call_2", outputJson: JSON.stringify("") });
  });

  test("search_web keeps its query and unknown tools keep their agy name", () => {
    expect(
      normalizeAntigravityChunk(
        update({ sessionUpdate: "tool_call", toolCallId: "c3", name: "search_web", status: "in_progress", kind: "search", title: '"node lts" on Web', rawInput: { query: "node lts" } })
      )
    ).toMatchObject({ toolName: "WebSearch", inputJson: JSON.stringify({ query: "node lts" }) });
    expect(
      normalizeAntigravityChunk(update({ sessionUpdate: "tool_call", toolCallId: "c4", name: "list_dir", status: "in_progress", title: "List", rawInput: { Dir: "/w" } }))
    ).toMatchObject({ toolName: "list_dir", inputJson: JSON.stringify({ Dir: "/w" }) });
  });

  test("a refusal stop reason warns that the quota may be used up", () => {
    expect(
      normalizeAntigravityChunk({ type: "convoy/acp_prompt_result", data: JSON.stringify({ sessionId: "s-1", stopReason: "refusal" }) })
    ).toMatchObject({ kind: "warning", code: "acp-refusal", message: expect.stringContaining("quota") });
  });
});
