import { ConvexError } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { Status } from "@/lib/tasks/status";
import { isAllowedProjectTaskStatus } from "@/lib/tasks/status-policy";

export function assertProjectAllowsStatus(project: Doc<"projects">, status: Status) {
  if (!isAllowedProjectTaskStatus(project, status)) {
    throw new ConvexError(`Status '${status}' is disabled for this project`);
  }
}
