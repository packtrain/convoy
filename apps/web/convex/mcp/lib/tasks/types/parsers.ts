import { throwInvalidParams } from "../../should";
import { getBuiltInTaskTypeKeys } from "@/lib/tasks/task-types";

export function ensureValidTaskTypeKey(key: string): void {
  const keys = getBuiltInTaskTypeKeys();
  if (!keys.includes(key)) {
    throwInvalidParams(`taskTypeKey must be one of: ${keys.join(", ")}`);
  }
}
