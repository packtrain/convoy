import { ProjectAddError } from "../project/validators.js";
import { input, select } from "@inquirer/prompts";
import { z } from "zod";
import { accessibleProjectSchema, organizationChoiceSchema, type AccessibleProject } from "./validators.js";
import { api } from "../../convex/_generated/api.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";
import { promptProjectSelect } from "./prompts.js";

const PROJECT_ALIAS_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/i;

export interface ProjectSelectionOptions {
  project?: string;
  create?: boolean;
  org?: string;
  projectName?: string;
  projectAlias?: string;
  profileName?: string;
  profileKey?: string;
}

export function validateProjectSelection(options: ProjectSelectionOptions, interactive: boolean): void {
  if (options.create && options.project) throw new Error("Use either --create or --project, not both.");
  if (!options.create && (options.projectName || options.projectAlias || options.org)) {
    throw new Error("--org, --project-name and --project-alias require --create.");
  }
  if (!interactive && options.create && (!options.org || !options.projectName || !options.projectAlias)) {
    throw new Error("Non-interactive creation requires --org, --project-name and --project-alias.");
  }
  if (options.projectName !== undefined && !options.projectName.trim()) throw new Error("Project name is required.");
  if (options.projectAlias !== undefined && !PROJECT_ALIAS_PATTERN.test(options.projectAlias)) {
    throw new Error("Project alias must be 2-5 letters or numbers, starting with a letter.");
  }
}

export function suggestProjectAlias(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  let alias =
    words.length === 1
      ? words[0].slice(0, 3)
      : words
          .slice(0, 5)
          .map((word) => word[0])
          .join("");
  if (!alias) return "PRJ";
  if (!/^[A-Z]/.test(alias)) alias = `P${alias}`;
  return alias.slice(0, 5).padEnd(2, "P");
}

/** Resolve existing projects or create once; callers retain the reported identity on failure. */
export async function resolveSetupProject(
  client: ConvoyClient,
  options: ProjectSelectionOptions,
  interactive: boolean,
  projects?: AccessibleProject[],
  beforeCreate?: () => Promise<void>,
  output = { log: (message: string) => console.log(message), creating: () => {} },
): Promise<AccessibleProject> {
  validateProjectSelection(options, interactive);
  const available = projects ?? z.array(accessibleProjectSchema).parse(await client.query(api.projects.core.listAccessible, {}));
  const selected = options.create
    ? "__create__"
    : (options.project ?? (interactive ? await promptProjectSelect(available, true) : undefined));
  if (selected !== "__create__") {
    const project = available.find((p) => p._id === selected);
    if (!project) throw new ProjectAddError("project-unavailable", `Project "${selected ?? ""}" was not found in accessible projects.`);
    return project;
  }
  await beforeCreate?.();
  const scope = await client.query(api.apiKeys.core.currentScope, {});
  if (scope?.kind === "organization" && scope.projectIds.length > 0) {
    throw new Error("Project creation requires an unscoped or organization-wide API key.");
  }
  const organizations = z.array(organizationChoiceSchema).parse(await client.query(api.organizations.core.listForUser, {}));
  if (!organizations.length) throw new Error("No accessible organizations. Create an account and organization in Convoy first.");
  const orgRef =
    options.org ??
    (await select({ message: "Organization:", choices: organizations.map((o) => ({ name: `${o.name} (${o.slug})`, value: o._id })), loop: false }));
  const organization = organizations.find((o) => o._id === orgRef || o.slug === orgRef);
  if (!organization) throw new Error("Organization is not accessible with this key.");
  const name = (
    options.projectName ??
    (await input({
      message: "Project name:",
      default: options.profileName?.trim() || options.profileKey,
      validate: (value) => Boolean(value.trim()) || "Name is required",
    }))
  ).trim();
  const alias = (
    options.projectAlias ??
    (await input({
      message: "Project alias (2-5 letters/numbers):",
      default: suggestProjectAlias(name),
      validate: (value) => PROJECT_ALIAS_PATTERN.test(value) || "Use 2-5 letters/numbers, starting with a letter",
    }))
  ).toUpperCase();

  if (available.some((p) => p.organizationId === organization._id && p.alias === alias)) {
    throw new Error(`Project ${alias} already exists. Select it with --project instead of --create.`);
  }
  let id: AccessibleProject["_id"];
  try {
    output.creating();
    id = await client.mutation(api.projects.core.create, { organizationId: organization._id, name, alias });
  } catch (error) {
    throw new Error(
      `Project creation did not return a confirmed result. Check Convoy for ${alias} in ${organization.slug} before retrying; use --project if it exists. ${error instanceof Error ? error.message : "Creation failed."}`
    );
  }
  output.log(
    `Created remote project ${name} (${alias}), ID ${id}. If setup fails, retry with --project ${id} instead of --create; remote data will be retained.`
  );
  return { _id: id, name, alias, organizationId: organization._id, organizationName: organization.name };
}
