import { isRecord } from "@/lib/type-guards";
import type { CliBackgroundTask, CliBackgroundTasks } from "@/convex/lib/contracts/validators";
import type { ParseResult } from "../contracts";

export function success<T>(value: T): ParseResult<T> {
  return { success: true, value };
}

export function failure<T>(message: string): ParseResult<T> {
  return { success: false, message };
}

const MAX_BACKGROUND_TASKS = 200;
const MAX_BACKGROUND_DESCRIPTION_CHARS = 2000;
const MAX_BACKGROUND_TYPE_CHARS = 128;

function truncateTaskText(text: string, limit: number): string {
  const lastCode = text.charCodeAt(limit - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, end);
}

/** Bound the live projection; retain the full count for unusually large snapshots. */
export function readBackgroundTasks(obj: Record<string, unknown>): CliBackgroundTasks | undefined {
  if (!Array.isArray(obj.tasks) || obj.parent_tool_use_id) return undefined;
  const tasks: CliBackgroundTask[] = [];
  const ids = new Set<string>();
  for (const task of obj.tasks) {
    if (!isRecord(task) || typeof task.task_id !== "string" || !task.task_id.trim()) continue;
    if (ids.has(task.task_id)) continue;
    ids.add(task.task_id);
    if (tasks.length >= MAX_BACKGROUND_TASKS) continue;
    tasks.push({
      id: task.task_id,
      type: typeof task.task_type === "string" ? truncateTaskText(task.task_type, MAX_BACKGROUND_TYPE_CHARS) : "unknown",
      description: typeof task.description === "string" ? truncateTaskText(task.description, MAX_BACKGROUND_DESCRIPTION_CHARS) : "",
    });
  }
  // Invalid entries must not turn an unusable payload into an authoritative empty set.
  if (obj.tasks.length > 0 && ids.size === 0) return undefined;
  return {
    ...(typeof obj.session_id === "string" ? { sessionId: obj.session_id } : {}),
    tasks,
    totalCount: typeof obj.total_count === "number" && Number.isSafeInteger(obj.total_count) && obj.total_count >= ids.size ? obj.total_count : ids.size,
  };
}
