import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type CheckDefinition = FunctionReturnType<typeof api.checks.definitions.list>[number];
export type Checklist = FunctionReturnType<typeof api.checks.checklists.list>[number];
export type TaskChecks = NonNullable<FunctionReturnType<typeof api.checks.checklists.getForTask>>;
export type TaskCheck = TaskChecks["checks"][number];
export type CheckResult = TaskCheck["results"][number];
/** A row's state: a result's status, or pending before any result. */
export type CheckGlyph = CheckResult["status"] | "pending";
/** Links "Reported in…" to the viewer's own thread. */
export type ProjectRoute = { organizationSlug: string; projectAlias: string };
