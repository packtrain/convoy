import { isRecord } from "../../sdk/adapters/adapter-interface.js";

/** Tiny narrowing helpers shared across the opencode runtime modules. */

export function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
