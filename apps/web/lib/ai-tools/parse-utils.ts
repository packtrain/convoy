/**
 * Shared helpers for extracting typed values from `Record<string, unknown>` objects
 * produced by parsing tool call input/output.
 */

import { isRecord } from "@/lib/type-guards";

export function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

export function getStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

export function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined;
export function getBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean;
export function getBoolean(record: Record<string, unknown>, key: string, fallback?: boolean): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

export type ToolOutputTextPreference = "content" | "filenames";

export function getToolOutputText(
  rawOutput: unknown,
  preferred: ToolOutputTextPreference = "content"
): string | undefined {
  if (typeof rawOutput === "string") {
    return rawOutput;
  }

  if (!isRecord(rawOutput)) {
    return undefined;
  }

  const content = getString(rawOutput, "content");
  const filenames = getStringArray(rawOutput, "filenames")?.join("\n");

  return preferred === "filenames"
    ? filenames ?? content
    : content ?? filenames;
}
