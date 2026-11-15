import { authDescriptor, assertCredentialNames, launchCapabilities, launchPayload } from "../../lib/config/credentials/resolution.js";
import type { CredentialData } from "../../lib/config/credentials/validators.js";
import { ServiceStartupError } from "./errors.js";
import { resolve, dirname, isAbsolute } from "node:path";
import type { ConfigFile } from "../../lib/config/types.js";
import type { ServiceProfile } from "./validators.js";
import type { Profile } from "../../lib/config/types.js";
import { projectIdentity, profileKeySchema, type ProjectEnvironment } from "../project/validators.js";

const displayName = (profile: Profile) => [...profile.name.trim()].slice(0, 50).join("");

export function serviceSnapshot(config: ConfigFile, environment: ProjectEnvironment, credentials?: CredentialData): ServiceProfile[] {
  if (credentials) assertCredentialNames(credentials,config.keys);
  const seen = new Set<string>();
  return Object.entries(config.profiles).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, profile]) => {
    if (profile.project_mode) throw new ServiceStartupError("This environment is isolated and cannot run shared registrations. Remove them with convoy project remove.");
    const isolation = profile.project_isolation;
    if (!isolation) return [];
    const registration = environment.registrations.find((item) => item.identity === isolation.identity);
    if (!profileKeySchema.safeParse(key).success || !registration || registration.status === "pending" || registration.status === "removed" ||
        profile.paths.length !== 1 || profile.paths[0] !== registration.path ||
        resolve(registration.path) !== registration.path || dirname(registration.path) !== environment.workspace ||
        projectIdentity(profile.url, isolation.organization_id, profile.project_id) !== isolation.identity || profile.provider_key || profile.codex_provider_key || Buffer.byteLength(JSON.stringify(profile)) > 32768) {
      throw new ServiceStartupError("Invalid service registration snapshot. Check project list and re-register mismatched profiles.");
    }
    if (seen.has(isolation.identity)) return [];
    if (seen.size >= 128) throw new ServiceStartupError("Service supports at most 128 project identities per environment.");
    seen.add(isolation.identity);
    const auth = credentials ? authDescriptor(credentials,isolation.identity) : undefined;
    const capabilities = credentials ? launchCapabilities(launchPayload(credentials, auth)) : [];
    if (capabilities.some((capability) => !environment.capabilities?.includes(capability))) throw new ServiceStartupError("Managed credentials require an updated project launcher. Reinstall the launcher before starting.");
    return [{ key, displayName: displayName(profile), identity: isolation.identity, ...(auth ? {auth} : {}), config: {
      convexUrl: profile.url, apiKey: profile.api_key, projectId: profile.project_id,
      organizationId: isolation.organization_id, profileKey: key,
      concurrency: profile.concurrency, partialStreaming: profile.streaming,
      isolated: profile.isolated, jsonEvents: true,
    } }];
  });
}

/** Shared mode: registrations the service runs as this account. Spec: docs/specs/cli-shared-environments.md#execution */
export function sharedServiceSnapshot(config: ConfigFile, credentials?: CredentialData): ServiceProfile[] {
  if (credentials) assertCredentialNames(credentials, config.keys);
  if (Object.values(config.profiles).some(profile => profile.project_isolation)) {
    throw new ServiceStartupError("This environment is shared, but config.toml holds isolated registrations. They need the project launcher; it never runs them unsandboxed. Remove them with convoy project remove.");
  }
  const seen = new Map<string, string>();
  return Object.entries(config.profiles).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, profile]) => {
    if (!profile.project_mode) return [];
    const organization = profile.project_organization;
    const path = profile.paths[0];
    if (!profileKeySchema.safeParse(key).success || !organization || profile.paths.length !== 1 || !isAbsolute(path) || resolve(path) !== path ||
        profile.provider_key || profile.codex_provider_key || Buffer.byteLength(JSON.stringify(profile)) > 32768) {
      throw new ServiceStartupError("Invalid service registration snapshot. Check project list and re-register mismatched profiles.");
    }
    const identity = projectIdentity(profile.url, organization, profile.project_id);
    if (seen.has(identity)) {
      if (seen.get(identity) !== path) throw new ServiceStartupError("Invalid service registration snapshot. Aliases of one project must use the same folder; re-register the mismatched profile.");
      return [];
    }
    if (seen.size >= 128) throw new ServiceStartupError("Service supports at most 128 project identities per environment.");
    seen.set(identity, path);
    const auth = credentials ? authDescriptor(credentials, identity) : undefined;
    return [{ key, displayName: displayName(profile), identity, path, ...(auth ? { auth } : {}), config: {
      convexUrl: profile.url, apiKey: profile.api_key, projectId: profile.project_id,
      organizationId: organization, profileKey: key,
      concurrency: profile.concurrency, partialStreaming: profile.streaming,
      isolated: profile.isolated, jsonEvents: true, mode: "shared" as const,
    } }];
  });
}
