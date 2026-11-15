import type { Command } from "commander";
import type { Id } from "../convex/_generated/dataModel.js";
import type { ConvoyClient, RequiredConfig } from "./config/index.js";
import { getGlobalProjectOption } from "./global-options.js";
import { resolveOrganizationId } from "./organization-resolution.js";
import { parseOptionalEnum } from "./parsers.js";
import { resolveProjectFromCommand } from "./project-resolution.js";
import type { OutputOptions } from "./output.js";

/**
 * Scope flags for an entity that exists in both scopes — prompts and Skills.
 * Project scope is the default: a profile is configured for one project.
 */
export interface ScopeOptions extends OutputOptions {
  scope?: string;
  org?: string;
}

export type Scope = "project" | "organization";

export type ScopeTarget =
  | { scope: "project"; projectId: Id<"projects"> }
  | { scope: "organization"; organizationId: Id<"organizations"> };

export function addScopeOptions<T extends Command>(cmd: T, entity: string): T {
  return cmd
    .option("--scope <scope>", `${entity} scope: project or organization (default: project)`)
    .option("--org <org>", "Organization ID or slug") as T;
}

// Same vocabulary as the MCP `scope` argument — no `org` alias, so a script reads
// the same on both surfaces. Unexported: `parseScope` is taken by `init`, for a
// different scope vocabulary.
function parseScope(options: ScopeOptions): Scope {
  return parseOptionalEnum(options.scope, "Scope", ["project", "organization"] as const) ?? "project";
}

/**
 * Organization scope takes `--org` when given and otherwise borrows the resolved
 * project's organization, so the common case needs no extra flag.
 */
export async function resolveScopeTarget(
  client: ConvoyClient,
  config: RequiredConfig,
  cmd: Command,
  options: ScopeOptions
): Promise<ScopeTarget> {
  const scope = parseScope(options);

  if (scope === "project") {
    if (options.org && !getGlobalProjectOption(cmd)) {
      // In project scope `--org` only disambiguates `--project`; alone it reads
      // as "the organization", which is a different scope.
      throw new Error("--org needs --project in project scope. Pass --scope organization to target the organization itself.");
    }

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    return { scope, projectId };
  }

  return { scope, organizationId: await resolveOrganizationId(client, config, cmd, options.org) };
}
