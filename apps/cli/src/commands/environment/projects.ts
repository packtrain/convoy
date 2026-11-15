import { input, select } from "@inquirer/prompts";
import { z } from "zod";
import { api } from "../../convex/_generated/api.js";
import { createConvexClient } from "../../lib/config/convex-client.js";
import { promptApiKey, promptProfileKey, promptProjectSelect, promptUrl } from "../setup/prompts.js";
import { accessibleProjectSchema, organizationChoiceSchema } from "../setup/validators.js";
import { validateProjectSelection } from "../setup/resolution.js";
import { normalizeConvexUrl } from "../../lib/url.js";
import { unavailableProjectResult, projectAddResultSchema, assertDeploymentUrl } from "../project/validators.js";
import type { ProjectAddOptions } from "../project/workflow.js";
import { docker, helperArgs } from "./docker.js";
import { containerName, type Environment } from "./validators.js";

export async function addTargetProject(environment: Environment, directory: string, options: ProjectAddOptions) {
  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY);
  validateProjectSelection(options, interactive);
  if (!interactive && (!options.url || !options.apiKey || !options.profileKey || (!options.project && !options.create))) {
    throw new Error("Non-interactive target registration requires --url, --api-key, --profile-key and --project or --create inputs.");
  }
  const url = normalizeConvexUrl(options.url ?? await promptUrl());
  assertDeploymentUrl(url);
  const apiKey = options.apiKey ?? await promptApiKey();
  const profileKey = options.profileKey ?? await promptProfileKey(directory);
  const client = createConvexClient({ url, apiKey });
  try {
    const available = z.array(accessibleProjectSchema).parse(await client.query(api.projects.core.listAccessible, {}));
    const selected = options.create ? "__create__" : options.project ?? await promptProjectSelect(available, true);
    let creation: { create: true; org: string; projectName: string; projectAlias: string } | undefined;
    if (selected === "__create__") {
      const organizations = z.array(organizationChoiceSchema).parse(await client.query(api.organizations.core.listForUser, {}));
      if (!organizations.length) throw new Error("No accessible organizations. Create an organization in Convoy first.");
      const org = options.org ?? await select({ message: "Organization:", choices: organizations.map(o => ({ name: o.name, value: o._id })), loop: false });
      const projectName = options.projectName ?? await input({ message: "Project name:", default: profileKey });
      const projectAlias = options.projectAlias ?? await input({ message: "Project alias (2-5 letters/numbers):", default: projectName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(2, "P") });
      creation = { create: true, org, projectName, projectAlias };
    }
    const payload = { directory, options: { url, apiKey, profileKey, ...(creation ?? { project: selected }), reuse: options.reuse, clone: options.clone } };
    await docker(helperArgs(environment, "allow-domain", new URL(url).hostname), { progress: true, timeout: 180_000 });
    const output = await docker(["exec", "-i", "--user", "node", containerName(environment), "node",
      "/opt/convoy/node_modules/@useconvoy/cli/dist/src/commands/environment/setup-entrypoint.js"], { input: JSON.stringify(payload), redact: [apiKey], timeout: 360_000 });
    console.log(output);
  } finally { await client.close(); }
}

export async function addTargetProjectGuided(environment: Environment, directory: string, options: ProjectAddOptions) {
  const url = normalizeConvexUrl(options.url ?? "");
  assertDeploymentUrl(url);
  try {
    if (!await supportsGuidedProject(environment)) return { ...unavailableProjectResult(), reason: "target-incompatible" as const };
  } catch { return unavailableProjectResult(); }
  try { await docker(helperArgs(environment, "allow-domain", new URL(url).hostname), { timeout: 180_000 }); }
  catch { return unavailableProjectResult(); }
  const output = await docker(["exec", "-i", "--user", "node", containerName(environment), "node",
    "/opt/convoy/node_modules/@useconvoy/cli/dist/src/commands/environment/setup-entrypoint.js"],
  { input: JSON.stringify({ guided: true, directory, options }), timeout: 360_000 });
  return projectAddResultSchema.parse(JSON.parse(output));
}

export async function supportsGuidedProject(environment: Environment) {
  // Probe the installed schema without sending credentials or running registration.
  try {
    const output = await docker(["exec", "--user", "node", containerName(environment), "node", "--input-type=module", "-e",
      `import { setupRequestSchema } from '/opt/convoy/node_modules/@useconvoy/cli/dist/src/commands/environment/validators.js';
const request = { guided: true, directory: 'compatibility-probe', options: { url: 'https://example.invalid', apiKey: 'probe', profileKey: 'probe', profileName: 'Probe', project: 'probe' } };
process.stdout.write(JSON.stringify({ guided: setupRequestSchema.safeParse(request).success }));`], { timeout: 15_000 });
    if (!z.object({ guided: z.boolean() }).strict().parse(JSON.parse(output)).guided) {
      return false;
    }
  } catch { throw new Error("Cannot check target setup support. Start the environment and retry."); }
  return true;
}
