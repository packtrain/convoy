import { z } from "zod";
import { isRecord } from "../sdk/adapters/adapter-interface.js";

/** Validate the standard MCP form subset before returning user content to the server. */
export function validMcpForm(schema: unknown, content: unknown): boolean {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties) || !isRecord(content)) return false;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => typeof key !== "string" || !Object.hasOwn(content, key))) return false;
  return Object.entries(content).every(([key, value]) => {
    const field = schema.properties && isRecord(schema.properties) ? schema.properties[key] : undefined;
    if (!isRecord(field)) return false;
    const choices = (source: Record<string, unknown>): unknown[] | undefined => {
      if (Array.isArray(source.enum)) return source.enum;
      const options = source.oneOf ?? source.anyOf;
      return Array.isArray(options) ? options.filter(isRecord).map((option) => option.const) : undefined;
    };
    const values = choices(field);
    if (values && !values.includes(value)) return false;
    if (field.type === "boolean") return typeof value === "boolean";
    if (field.type === "number" || field.type === "integer") {
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.type !== "integer" || Number.isInteger(value)) &&
        (typeof field.minimum !== "number" || value >= field.minimum) &&
        (typeof field.maximum !== "number" || value <= field.maximum)
      );
    }
    if (field.type === "string") {
      const formats = { email: z.email(), uri: z.url(), date: z.iso.date(), "date-time": z.iso.datetime({ offset: true }) };
      const format =
        typeof field.format === "string" && Object.hasOwn(formats, field.format)
          ? formats[field.format as keyof typeof formats]
          : undefined;
      return (
        typeof value === "string" &&
        (!format || format.safeParse(value).success) &&
        (typeof field.minLength !== "number" || value.length >= field.minLength) &&
        (typeof field.maxLength !== "number" || value.length <= field.maxLength)
      );
    }
    if (field.type === "array" && isRecord(field.items)) {
      const allowed = choices(field.items);
      return (
        Array.isArray(value) &&
        !!allowed &&
        value.every((item) => allowed.includes(item)) &&
        new Set(value).size === value.length &&
        (typeof field.minItems !== "number" || value.length >= field.minItems) &&
        (typeof field.maxItems !== "number" || value.length <= field.maxItems)
      );
    }
    return false;
  });
}

const MAX_BACKGROUND_TASKS = 200;
const MAX_BACKGROUND_DESCRIPTION_CHARS = 2000;
const MAX_BACKGROUND_TYPE_CHARS = 128;
const MAX_BACKGROUND_ID_CHARS = 512;
const MAX_BACKGROUND_SNAPSHOT_CHARS = 60_000;

function clipTaskText(text: string, limit: number): string {
  const code = text.charCodeAt(limit - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}

/** Bound snapshots before upload; count omitted entries without breaking their JSON. */
export function boundBackgroundTasks(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(obj.tasks)) return undefined;
  const unique = new Map<string, Record<string, unknown>>();
  for (const task of obj.tasks) {
    if (isRecord(task) && typeof task.task_id === "string" && task.task_id.trim() && !unique.has(task.task_id)) unique.set(task.task_id, task);
  }
  if (obj.tasks.length > 0 && unique.size === 0) return undefined;
  const reportedCount = obj.total_count;
  const totalCount = typeof reportedCount === "number" && Number.isSafeInteger(reportedCount) && reportedCount >= unique.size ? reportedCount : unique.size;
  const envelope: Record<string, unknown> = { tasks: [], total_count: totalCount };
  for (const key of ["type", "subtype", "session_id", "parent_tool_use_id", "uuid"]) {
    if (typeof obj[key] === "string") envelope[key] = clipTaskText(obj[key], MAX_BACKGROUND_ID_CHARS);
  }
  const tasks: Record<string, unknown>[] = [];
  let size = JSON.stringify(envelope).length;
  for (const [id, task] of unique) {
    if (tasks.length >= MAX_BACKGROUND_TASKS) break;
    if (id.length > MAX_BACKGROUND_ID_CHARS) continue;
    const entry = {
      task_id: id,
      task_type: typeof task.task_type === "string" ? clipTaskText(task.task_type, MAX_BACKGROUND_TYPE_CHARS) : "unknown",
      description: typeof task.description === "string" ? clipTaskText(task.description, MAX_BACKGROUND_DESCRIPTION_CHARS) : "",
    };
    const length = JSON.stringify(entry).length + 1;
    if (size + length > MAX_BACKGROUND_SNAPSHOT_CHARS) break;
    tasks.push(entry);
    size += length;
  }
  return { ...envelope, tasks };
}
