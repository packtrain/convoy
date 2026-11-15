import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export type ToolHandlerContext = {
  ctx: ActionCtx;
  apiKey: string;
  args: Record<string, unknown>;
  defaultProjectParam: string | undefined;
  /** Cached resolver: explicit `projectId` arg → URL default → throw. */
  getProjectId: () => Promise<Id<"projects">>;
  /** Cached resolver: explicit `organization` arg → resolved project's organization. */
  getOrganizationId: () => Promise<Id<"organizations">>;
};

export type ToolContent = {
  type: string;
  text: string;
};

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

export type ToolHandler = (toolCtx: ToolHandlerContext) => Promise<unknown>;
