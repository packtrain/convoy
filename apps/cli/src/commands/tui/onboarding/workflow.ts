import { z } from "zod";
import { api } from "../../../convex/_generated/api.js";
import { createConvexHttpClient } from "../../../lib/config/convex-client.js";
import { accessibleProjectSchema, organizationChoiceSchema } from "../../setup/validators.js";
import { assertChildPath, assertDeploymentUrl, validateProfileKey } from "../../project/validators.js";
import { normalizeConvexUrl } from "../../../lib/url.js";
import { validateProjectSelection } from "../../setup/resolution.js";
import type { ProjectAddOptions } from "../../project/workflow.js";

export async function loadChoices(url: string, apiKey: string, signal?: AbortSignal) {
  url = normalizeConvexUrl(url);
  assertDeploymentUrl(url);
  const abort = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const client = createConvexHttpClient({ url, apiKey }, requestSignal);
  requestSignal.throwIfAborted();
  try {
    const [projects, organizations] = await Promise.all([
      client.query(api.projects.core.listAccessible, {}), client.query(api.organizations.core.listForUser, {}),
    ]);
    return { projects: z.array(accessibleProjectSchema).parse(projects), organizations: z.array(organizationChoiceSchema).parse(organizations) };
  } finally { abort.abort(); }
}

export function validateForm(directory: string, options: ProjectAddOptions, cloneSelected = Boolean(options.clone)) {
  assertDeploymentUrl(normalizeConvexUrl(options.url ?? ""));
  validateProfileKey(options.profileKey ?? "");
  validateProjectSelection(options, false);
  if (!options.profileName?.trim() || options.profileName.length > 50) throw new Error("Profile name must be 1-50 characters.");
  assertChildPath(directory);
  if (directory.length > 256) throw new Error("Workspace path must be at most 256 characters.");
  if (cloneSelected && !options.clone?.trim()) throw new Error("Clone URL is required.");
  if (options.clone) {
    const clone = new URL(options.clone);
    if (clone.protocol !== "https:" || clone.username || clone.password || clone.search || clone.hash) throw new Error("Clone URL must use HTTPS without credentials, query or fragment.");
  }
}

/** Reuse inspected endpoints without fetching credentials or contacting deployments. */
export function savedDeploymentUrls(endpoints: string[]): string[] {
  const urls = new Set<string>();
  for (const endpoint of endpoints) {
    try {
      const url = normalizeConvexUrl(endpoint);
      assertDeploymentUrl(url);
      urls.add(new URL(url).origin);
    } catch { /* Unsupported endpoints stay available through manual entry. */ }
  }
  return [...urls];
}

/** Add project supports the runtimes with private-shell login actions. */
export function runtimeAccessChoices(runtime: "codex" | "claude-code", entries: import("../../../lib/config/credentials/validators.js").ManagedCredentialStatus["entries"]) {
  return entries.filter(entry => entry.enabled && (["bedrock", "mantle"].includes(entry.provider) || runtime === "codex" && entry.provider === "openai"));
}
