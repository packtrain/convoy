import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";
import { acpContentText, defaultAcpTool, normalizeAcpChunk, type AcpToolAdapter } from "../acp/normalizeChunk";

/** agy's ACP quirks over the generic mapping. Spec: docs/specs/cli-antigravity-runtime.md. */

const COMMAND_KEYS = ["CommandLine", "commandLine", "command_line", "command"];
const PATH_KEYS = ["Path", "AbsolutePath", "TargetFile", "path", "file_path"];

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pick(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getString(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** "Running ls" and "Run `ls`?" titles name the command when rawInput does not. */
function commandFromTitle(title: string): string {
  return /^Run(?:ning)?\s+`?(.+?)`?\??$/.exec(title)?.[1] ?? title;
}

/** agy puts timestamps and the exit code above a command's output. */
function commandOutput(raw: string): string {
  const marker = "Command output:\n";
  const start = raw.indexOf(marker);
  return (start >= 0 ? raw.slice(start + marker.length) : raw).replace(/\r\n/g, "\n");
}

function firstDiff(update: Record<string, unknown>): Record<string, unknown> {
  const diff = Array.isArray(update.content) ? update.content.find((entry) => isRecord(entry) && entry.type === "diff") : undefined;
  return isRecord(diff) ? diff : {};
}

/** Maps agy tool names onto the names the thread's tool renderers know. */
export const antigravityTool: AcpToolAdapter = (update) => {
  const base = defaultAcpTool(update);
  const input = isRecord(update.rawInput) ? update.rawInput : {};
  const filePath = pick(input, PATH_KEYS);
  switch (getString(update.name)) {
    case "run_command": {
      const rawOutput = isRecord(update.rawOutput) ? update.rawOutput : {};
      const raw = getString(rawOutput.output) ?? acpContentText(update);
      const stdout = commandOutput(raw);
      const exitCode = getFiniteNumber(rawOutput.exit_code) ?? Number(/Command exited with code (-?\d+)/.exec(raw)?.[1] ?? 0);
      const errorText =
        exitCode !== 0
          ? `Command exited with code ${exitCode}.${stdout ? `\n\n${stdout}` : ""}`
          : update.status === "failed"
            ? stdout || "Command did not finish."
            : undefined;
      const description = getString(input.toolSummary);
      return {
        toolName: "Bash",
        input: { command: pick(input, COMMAND_KEYS) ?? commandFromTitle(getString(update.title) ?? ""), ...(description ? { description } : {}) },
        output: { stdout },
        ...(errorText !== undefined ? { errorText } : {}),
      };
    }
    case "write_file":
      return { ...base, toolName: "Write", input: { file_path: filePath, content: getString(input.Content) ?? getString(firstDiff(update).newText) } };
    case "edit_file": {
      const diff = firstDiff(update);
      return {
        ...base,
        toolName: "Edit",
        input: {
          file_path: filePath,
          old_string: getString(input.Target) ?? getString(diff.oldText),
          new_string: getString(input.Replacement) ?? getString(diff.newText),
        },
        output: "",
      };
    }
    case "read_file":
    case "view_file":
    case "client_view_file":
      return { ...base, toolName: "Read", input: { file_path: filePath }, output: acpContentText(update) };
    case "ask_question": {
      // Pending means agy ended the turn to wait; the inline question part sends the answer as the next prompt.
      const questions = (Array.isArray(input.questions) ? input.questions : []).filter(isRecord).map((question) => ({
        question: getString(question.question) ?? "",
        multiSelect: question.is_multi_select === true,
        options: (Array.isArray(question.options) ? question.options : []).flatMap((label) => (typeof label === "string" ? [{ label }] : [])),
      }));
      return {
        ...base,
        toolName: "AskUserQuestion",
        input: { questions },
        ...(update.status === "pending" ? { errorText: "Antigravity is waiting for your answer." } : {}),
      };
    }
    case "search_web":
      return { ...base, toolName: "WebSearch", input, output: acpContentText(update) };
    default:
      return { ...base, toolName: getString(update.name) ?? base.toolName };
  }
};

/** The runner's `/compact` markers; agy reports none of its own. */
const ANTIGRAVITY_COMPACTION_CHUNK = "convoy/antigravity_compaction";

function compactionEvent(chunk: RawCliChunk): CliNormalizedEvent {
  let phase: unknown;
  try {
    phase = (JSON.parse(chunk.data) as { phase?: unknown }).phase;
  } catch {
    phase = undefined;
  }
  if (phase === "started") return { kind: "context-compaction", message: "Compacting…", inProgress: true };
  if (phase === "completed") return { kind: "context-compaction", message: "Conversation compacted" };
  return { kind: "context-compaction", message: "Compaction did not finish." };
}

export function normalizeAntigravityChunk(chunk: RawCliChunk): CliNormalizedEvent {
  if (chunk.type === ANTIGRAVITY_COMPACTION_CHUNK) return compactionEvent(chunk);
  const event = normalizeAcpChunk(chunk, antigravityTool);
  return event.kind === "warning" && event.code === "acp-refusal"
    ? { ...event, message: "Antigravity refused to continue. This usually means the account's quota is used up." }
    : event;
}
