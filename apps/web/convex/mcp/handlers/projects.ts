import { api } from "../../_generated/api";
import type { ToolHandler } from "./context";

/** Archived projects are hidden from discovery (docs/specs/project-archive.md). */
export const handleListProjects: ToolHandler = async ({ ctx, apiKey }) => {
  const projects = await ctx.runQuery(api.projects.core.listAccessible, { apiKey });
  return projects.filter((project) => !project.isArchived);
};
