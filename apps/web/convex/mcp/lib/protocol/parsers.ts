import { is } from "@/lib/type-guards";
import type { McpRequest } from "./guards";

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export function parseToolCallParams(
  params: McpRequest["params"]
): { ok: true; value: ToolCallParams } | { ok: false; message: string } {
  if (!is.record(params)) {
    return { ok: false, message: "Invalid params: expected an object" };
  }

  const name = params.name;
  if (!is.string(name) || name.length === 0) {
    return { ok: false, message: "Invalid params: 'name' must be a non-empty string" };
  }

  const rawArgs = params.arguments;
  let args: Record<string, unknown> | undefined;
  if (rawArgs !== undefined) {
    if (!is.record(rawArgs)) {
      return { ok: false, message: "Invalid params: 'arguments' must be an object" };
    }
    args = rawArgs;
  }

  return { ok: true, value: { name, ...(args !== undefined && { arguments: args }) } };
}
