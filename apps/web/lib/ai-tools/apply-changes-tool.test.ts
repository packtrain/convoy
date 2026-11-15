import { describe, expect, test } from "vitest";
import {
  buildApplyChangePatch,
  countApplyChangesLines,
  getApplyChangesTitle,
  parseApplyChangesToolPart,
} from "./apply-changes-tool";

const EXEC_CHANGE = {
  path: "/workspace/apps/web/components/blocks/thread/thread-list-item.tsx",
  kind: { type: "update", move_path: null },
  diff: '@@ -578,3 +578,3 @@\n           isUnread={chat.hasUnread}\n-          className="mt-2.5"\n+          className="flex size-5"\n         />\n',
};

describe("apply-changes-tool parser", () => {
  test("parses exec-style output with object kind", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Apply changes",
      toolCallId: "exec-1",
      state: "output-available",
      input: { changes: [EXEC_CHANGE] },
      output: { changes: [EXEC_CHANGE], status: "completed" },
    } as const;

    const payload = parseApplyChangesToolPart(part);
    expect(payload).toEqual({
      toolName: "Apply changes",
      toolCallId: "exec-1",
      state: "output-available",
      changes: [
        {
          path: EXEC_CHANGE.path,
          kind: "update",
          diff: EXEC_CHANGE.diff,
        },
      ],
    });
  });

  test("parses app-server-style string kind and falls back to input changes", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Apply changes",
      toolCallId: "as-1",
      state: "output-available",
      input: { changes: [{ path: "a.ts", kind: "add", diff: "+x" }] },
      output: { status: "completed" },
    } as const;

    expect(parseApplyChangesToolPart(part)?.changes).toEqual([
      { path: "a.ts", kind: "add", diff: "+x" },
    ]);
  });

  test("keeps input changes on error state with error text", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Apply changes",
      toolCallId: "err-1",
      state: "output-error",
      input: { changes: [{ path: "a.ts", kind: "update", diff: "+x" }] },
      errorText: "File changes were not approved.",
    } as const;

    const payload = parseApplyChangesToolPart(part);
    expect(payload?.state).toBe("output-error");
    expect(payload?.errorText).toBe("File changes were not approved.");
    expect(payload?.changes).toHaveLength(1);
  });

  test("ignores other tool names", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Edit",
      toolCallId: "t1",
      state: "input-available",
      input: { file_path: "a.ts" },
    } as const;

    expect(parseApplyChangesToolPart(part)).toBeNull();
  });

  test("buildApplyChangePatch prepends file headers to hunk-only diffs", () => {
    const patch = buildApplyChangePatch({ path: "a.ts", diff: "@@ -1,1 +1,1 @@\n-x\n+y" });
    expect(patch).toBe("--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n");
  });

  test("buildApplyChangePatch uses movePath for the new file header", () => {
    const patch = buildApplyChangePatch({
      path: "old.ts",
      movePath: "new.ts",
      diff: "@@ -1,1 +1,1 @@\n-x\n+y\n",
    });
    expect(patch.startsWith("--- a/old.ts\n+++ b/new.ts\n")).toBe(true);
  });

  test("buildApplyChangePatch synthesizes a hunk for delete-kind raw content", () => {
    const patch = buildApplyChangePatch({
      path: "gone.js",
      kind: "delete",
      diff: "const a = 1;\nconsole.log(a);\n",
    });
    expect(patch).toBe(
      "--- a/gone.js\n+++ b/gone.js\n@@ -1,2 +0,0 @@\n-const a = 1;\n-console.log(a);\n"
    );
  });

  test("buildApplyChangePatch synthesizes a hunk for add-kind raw content", () => {
    const patch = buildApplyChangePatch({
      path: "new.js",
      kind: "add",
      diff: "hello",
    });
    expect(patch).toBe("--- a/new.js\n+++ b/new.js\n@@ -0,0 +1,1 @@\n+hello\n");
  });

  test("countApplyChangesLines counts raw-content delete changes as deletions", () => {
    expect(
      countApplyChangesLines([
        { path: "gone.js", kind: "delete", diff: "const a = 1;\nconsole.log(a);\n" },
      ])
    ).toEqual({ additions: 0, deletions: 2 });
  });

  test("countApplyChangesLines counts additions and deletions across changes", () => {
    expect(
      countApplyChangesLines([
        { path: "a.ts", diff: "@@ -1,2 +1,2 @@\n ctx\n-x\n+y\n+z" },
        { path: "b.ts", diff: "@@ -1,1 +1,0 @@\n-gone" },
      ])
    ).toEqual({ additions: 2, deletions: 2 });
  });

  test("getApplyChangesTitle covers single, multiple, and empty changes", () => {
    const base = {
      toolName: "Apply changes",
      toolCallId: "t",
      state: "output-available",
    } as const;
    expect(
      getApplyChangesTitle({ ...base, changes: [{ ...EXEC_CHANGE, kind: "update" }] })
    ).toBe("Apply changes to thread-list-item.tsx");
    expect(
      getApplyChangesTitle({
        ...base,
        changes: [
          { path: "a.ts", diff: "" },
          { path: "b.ts", diff: "" },
        ],
      })
    ).toBe("Apply changes to 2 files");
    expect(getApplyChangesTitle({ ...base, changes: [] })).toBe("Apply changes");
  });
});
