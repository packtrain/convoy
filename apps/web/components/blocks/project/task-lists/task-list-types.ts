import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

export type TaskListItem =
  FunctionReturnType<typeof api.tasks.lists.list>["page"][number];
