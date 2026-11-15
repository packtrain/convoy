import { api } from "../../_generated/api";
import type { ToolHandler } from "./context";

export const handleListProjects: ToolHandler = async ({ ctx, apiKey }) => {
  return ctx.runQuery(api.projects.core.listAccessible, { apiKey });
};
