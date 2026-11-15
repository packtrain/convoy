import { is } from "@/lib/type-guards";

export type McpTaskTypeSummary = {
  key: string;
  name: string;
};

export function projectTaskTypeSummary(value: unknown): McpTaskTypeSummary | undefined {
  if (!is.record(value) || !is.string(value.key) || !is.string(value.name)) {
    return undefined;
  }
  return {
    key: value.key,
    name: value.name,
  };
}
