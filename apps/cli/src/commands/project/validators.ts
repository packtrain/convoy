import * as path from "node:path";
import { createHash } from "node:crypto";
import { MANAGED_RUNTIME_LABELS, claudeAuthSchema, codexAuthSchema, cursorAuthSchema, keyRuntimeSchema, opencodeAuthSchema } from "../../lib/config/credentials/validators.js";
import { z } from "zod";

export const projectRegistrationSchema = z.object({
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string(),
  uid: z.number().int().min(20000),
  active: z.boolean(),
  clone: z.string().nullable().optional(),
  status: z.enum(["pending", "stopped", "removed"]).optional(),
});
export const projectEnvironmentSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  workspace: z.string(),
  registrations: z.array(projectRegistrationSchema),
});
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;
/** Runtimes with a project login; Antigravity has no managed key yet (OS-2474). */
export const loginRuntimeSchema = z.enum([...keyRuntimeSchema.options, "antigravity"]);
export type LoginRuntime = z.infer<typeof loginRuntimeSchema>;
export const loginRuntimeLabels: Record<LoginRuntime, string> = { ...MANAGED_RUNTIME_LABELS, antigravity: "Antigravity" };
/** Each runtime's own login, run as this account in a shared environment. */
export const LOGIN_COMMANDS: Record<LoginRuntime, string> = {
  codex: "codex login --device-auth", "claude-code": "claude auth login", cursor: "NO_OPEN_BROWSER=1 cursor-agent login", opencode: "opencode auth login",
  antigravity: "agy acp --login",
};
const runtimeFactsSchema = z.object({ state: z.enum(["ready", "untrusted", "missing"]), home: z.boolean(), loggedIn: z.boolean() }).strict();
/** The launcher's read-only `check` answer. Spec: docs/specs/cli-project-isolation.md#failure-reasons-and-project-check-cli-01110-os-2161-os-2162 */
export const launcherCheckSchema = z.object({
  sandbox: z.string().max(4096).nullable(),
  holder: z.enum(["service", "connect", "shell", "login", "registration", "unknown"]).nullable(),
  // Launchers before CLI 0.117.0 report no Cursor, before 0.118.0 no OpenCode, before 0.159.0 no Antigravity.
  runtimes: z.object({ codex: runtimeFactsSchema, "claude-code": runtimeFactsSchema, cursor: runtimeFactsSchema.optional(), opencode: runtimeFactsSchema.optional(),
    antigravity: runtimeFactsSchema.optional() }).strict(),
}).strict();
export type LauncherCheck = z.infer<typeof launcherCheckSchema>;
export const projectCheckSchema = z.object({
  profile: z.string(),
  checks: z.array(z.object({ id: z.string(), status: z.enum(["pass", "fail", "skip"]), label: z.string(), fix: z.string().optional() }).strict()).max(32),
}).strict();
export type ProjectCheck = z.infer<typeof projectCheckSchema>;

export function assertDeploymentUrl(url: string): URL {
  const deployment = new URL(url);
  if (deployment.protocol !== "https:" || deployment.username || deployment.password || deployment.search || deployment.hash) {
    throw new Error("Project deployments must use HTTPS without embedded credentials, query or fragment.");
  }
  return deployment;
}

export function projectIdentity(url: string, organizationId: string, projectId: string): string {
  const deployment = assertDeploymentUrl(url);
  return createHash("sha256")
    .update(JSON.stringify([deployment.href.replace(/\/$/, ""), organizationId, projectId]))
    .digest("hex");
}

/** Identity of an isolated or shared registration; undefined for an ordinary profile. */
export function registrationIdentity(profile: { url: string; project_id: string; project_isolation?: { identity: string }; project_mode?: "shared"; project_organization?: string }): string | undefined {
  if (profile.project_isolation) return profile.project_isolation.identity;
  return profile.project_mode && profile.project_organization ? projectIdentity(profile.url, profile.project_organization, profile.project_id) : undefined;
}

export function requireProjectScope(
  scope: { kind: string; organizationId?: string; projectIds?: string[] } | null,
  organizationId: string,
  projectId: string,
): void {
  if (scope?.kind !== "organization" || scope.organizationId !== organizationId ||
      scope.projectIds?.length !== 1 || scope.projectIds[0] !== projectId) {
    throw new ProjectAddError("key-scope", "Use an API key restricted to this one project. Create it in Convoy settings; an account-wide or organization-wide key cannot be given to an isolated worker.");
  }
}

/** Shared mode accepts any key that can see the project: unscoped, organization-wide or scoped to it. */
export function requireVisibleProject(
  scope: { kind: string; organizationId?: string; projectIds?: string[] } | null,
  organizationId: string,
  projectId: string,
): void {
  if (scope?.kind === "unscoped") return;
  if (scope?.kind !== "organization" || scope.organizationId !== organizationId || (scope.projectIds?.length && !scope.projectIds.includes(projectId))) {
    throw new ProjectAddError("key-scope", "This API key cannot see the project. Use a key for its organization or for this project.");
  }
}

export const profileKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
export function validateProfileKey(key: string): void {
  if (!profileKeySchema.safeParse(key).success) {
    throw new Error("Invalid profile key. Use at most 80 lowercase letters, digits, underscores or hyphens, starting with a letter.");
  }
}

export const workerConfigSchema = z.object({
  convexUrl: z.string().url(), apiKey: z.string().min(1), projectId: z.string().min(1),
  organizationId: z.string().min(1), projectIdentity: z.string(),
  paths: z.array(z.string()).length(1), profileKey: profileKeySchema,
  connectionName: z.string().optional(), force: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(50).optional(),
  partialStreaming: z.boolean().optional(), isolated: z.boolean().optional(),
  codexAuth: codexAuthSchema.optional(), claudeAuth: claudeAuthSchema.optional(), cursorAuth: cursorAuthSchema.optional(), opencodeAuth: opencodeAuthSchema.optional(),
  codexAppServer: z.boolean().optional(), jsonEvents: z.boolean().optional(),
  /** Set by the service for a shared worker it spawns itself. Spec: docs/specs/cli-shared-environments.md#execution */
  mode: z.literal("shared").optional(),
}).strict();
export const workerLaunchConfigSchema = workerConfigSchema.omit({ paths: true, projectIdentity: true });
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type WorkerLaunchConfig = z.infer<typeof workerLaunchConfigSchema>;

export const projectAddResultSchema = z.object({
  ok: z.boolean(), projectId: z.string().optional(), registered: z.boolean(),
  applied: z.boolean(), retrySafe: z.boolean(),
  reason: z.enum(["environment-unavailable", "target-incompatible", "path", "profile-conflict", "workspace-overlap", "project-unavailable", "key-scope", "clone-mismatch"]).optional(),
  phase: z.enum(["validation", "creation", "preparation", "key", "registration", "complete"]),
}).strict();
export type ProjectAddResult = z.infer<typeof projectAddResultSchema>;

export class ProjectAddError extends Error {
  constructor(readonly reason: NonNullable<ProjectAddResult["reason"]>, message: string) { super(message); }
}

export function unavailableProjectResult(): ProjectAddResult {
  return { ok: false, registered: false, applied: false, retrySafe: true, phase: "validation", reason: "environment-unavailable" };
}

export function assertNoTraversal(directory: string): void {
  if (!directory || directory.split(/[\\/]/).some(part => part === "." || part === "..")) {
    throw new ProjectAddError("path", "Project paths cannot contain traversal components.");
  }
}

/** A shared Docker project sits under `/workspace` or a mount, never at a mount root. Spec: docs/specs/cli-shared-environments.md#projects */
export function assertManagedPath(target: string, mounts: string[]): void {
  if (mounts.includes(target)) throw new ProjectAddError("path", `${target} is a mounted folder. Mount its parent instead, so the project's worktrees stay on the host.`);
  if (!["/workspace", ...mounts].some(root => target.startsWith(root + "/"))) {
    throw new ProjectAddError("path", `Use a folder under /workspace or a mounted folder (${mounts.join(", ") || "none"}). A rebuild deletes anything else.`);
  }
}

export function assertChildPath(directory: string, workspace?: string): string {
  assertNoTraversal(directory);
  if (!directory || (!path.isAbsolute(directory) && path.dirname(directory) !== ".")) {
    throw new ProjectAddError("path", "Project path must be a direct child of the workspace.");
  }
  const target = workspace ? path.resolve(workspace, directory) : directory;
  if (workspace && path.dirname(target) !== workspace) throw new ProjectAddError("path", "Project path must be a direct child of the workspace.");
  return target;
}

const nativeAccountSchema = z.object({
  status: z.enum(["signed-in", "signed-out", "unknown"]),
  method: z.enum(["ChatGPT", "API key"]).optional(),
  account: z.string().max(254).optional(),
});
export const projectAccountsSchema = z.object({ codex: nativeAccountSchema, "claude-code": nativeAccountSchema });
export type ProjectAccounts = z.infer<typeof projectAccountsSchema>;
/** A shared project's runtimes, read in-process. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins */
export type SharedRuntimeStates = Record<LoginRuntime, {
  installed: boolean; login: z.infer<typeof nativeAccountSchema>["status"];
  /** Why the worker would not advertise an installed runtime, e.g. "1.5.11 is older than Convoy supports" (Antigravity only). */
  unusable?: string;
}>;
export interface SharedCheck { holder: string | null; runtimes: SharedRuntimeStates }
