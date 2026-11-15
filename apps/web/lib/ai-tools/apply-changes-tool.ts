import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { getString } from "@/lib/ai-tools/parse-utils";
import { getFilenameFromPath } from "@/lib/path-display";
import type { FileChangeLineCounts } from "@/lib/ai-tools/file-change-tool";
import { isRecord } from "@/lib/type-guards";

const APPLY_CHANGES_TOOL_NAME = "apply changes";

export type ApplyChangesFileChange = {
  path: string;
  /** "update" | "add" | "delete" — free-form from Codex */
  kind?: string;
  movePath?: string;
  diff: string;
};

export type ApplyChangesToolPayload = {
  toolName: string;
  toolCallId: string;
  state: "input-available" | "output-available" | "output-error";
  changes: ApplyChangesFileChange[];
  errorText?: string;
};

function parseChangeKind(raw: unknown): { kind?: string; movePath?: string } {
  // Codex exec emits kind as an object ({type, move_path}); app-server emits a plain string.
  if (typeof raw === "string") return { kind: raw };
  if (isRecord(raw)) {
    return {
      kind: getString(raw, "type"),
      movePath: getString(raw, "move_path") ?? getString(raw, "movePath"),
    };
  }
  return {};
}

function parseChanges(raw: unknown): ApplyChangesFileChange[] {
  if (!Array.isArray(raw)) return [];
  const changes: ApplyChangesFileChange[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const path = getString(item, "path");
    const diff = getString(item, "diff");
    if (path === undefined || diff === undefined) continue;
    changes.push({ path, diff, ...parseChangeKind(item.kind) });
  }
  return changes;
}

function extractChanges(record: unknown): ApplyChangesFileChange[] {
  return isRecord(record) ? parseChanges(record.changes) : [];
}

export function parseApplyChangesToolPart(
  part: UIMessage["parts"][number]
): ApplyChangesToolPayload | null {
  if (!isDynamicToolUIPart(part)) return null;
  if (part.toolName.toLowerCase() !== APPLY_CHANGES_TOOL_NAME) return null;

  const inputChanges = extractChanges("input" in part ? part.input : undefined);

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : undefined;
    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: "output-error",
      changes: inputChanges,
      ...(errorText ? { errorText } : {}),
    };
  }

  if (part.state === "output-available") {
    const outputChanges = extractChanges("output" in part ? part.output : undefined);
    return {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: "output-available",
      changes: outputChanges.length > 0 ? outputChanges : inputChanges,
    };
  }

  return {
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    state: "input-available",
    changes: inputChanges,
  };
}

/**
 * Codex `update` diffs are hunk-only unified diffs (no `---`/`+++` headers),
 * but `add`/`delete` diffs are the raw file content with no hunk markers at
 * all. Normalize both to hunk form so PatchDiff can render them.
 */
function toHunkDiff(change: ApplyChangesFileChange): string {
  if (change.diff.startsWith("@@")) return change.diff;

  const sign = change.kind === "delete" ? "-" : "+";
  const content = change.diff.endsWith("\n")
    ? change.diff.slice(0, -1)
    : change.diff;
  const lines = content.split("\n").map((line) => `${sign}${line}`);
  const header =
    sign === "-"
      ? `@@ -1,${lines.length} +0,0 @@`
      : `@@ -0,0 +1,${lines.length} @@`;
  return [header, ...lines].join("\n");
}

/**
 * Build a full unified patch (with `---`/`+++` file headers) for PatchDiff.
 */
export function buildApplyChangePatch(change: ApplyChangesFileChange): string {
  if (change.diff.startsWith("---") || change.diff.startsWith("diff --git")) {
    return change.diff.endsWith("\n") ? change.diff : `${change.diff}\n`;
  }
  const body = toHunkDiff(change);
  const newPath = change.movePath ?? change.path;
  return `--- a/${change.path}\n+++ b/${newPath}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

export function countApplyChangesLines(
  changes: ApplyChangesFileChange[]
): FileChangeLineCounts {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    for (const line of toHunkDiff(change).split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
  }
  return { additions, deletions };
}

export function getApplyChangesTitle(payload: ApplyChangesToolPayload): string {
  const count = payload.changes.length;
  if (count === 1)
    return `Apply changes to ${getFilenameFromPath(payload.changes[0].path)}`;
  if (count > 1) return `Apply changes to ${count} files`;
  return "Apply changes";
}
