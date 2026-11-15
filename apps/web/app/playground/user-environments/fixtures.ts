export type EnvironmentMode = "shared" | "isolated";
/** `idle`: the worker was stopped for inactivity and starts on the next thread (slice 6). */
export type RegistrationStatus = "pending" | "ready" | "idle" | "failed";

export interface PlaygroundProject {
  id: string;
  name: string;
  alias: string;
  organization: string;
  linkedRepo?: { fullName: string; isPrivate: boolean };
  /** Without PROJECT_UPDATE the owner's environments aren't offered. */
  canUpdate: boolean;
}

export interface PlaygroundEnvironment {
  id: string;
  name: string;
  hostname: string;
  mode: EnvironmentMode;
  isOnline: boolean;
  lastSeenAt: number;
  hasGitToken: boolean;
  availability: "all" | "selected";
  selectedProjectIds: string[];
}

export interface Registration {
  environmentId: string;
  projectId: string;
  status: RegistrationStatus;
  folder: string;
  profileKey: string;
  source: "clone" | "empty";
  error?: string;
}

export interface SetupInput {
  folder: string;
  profileKey: string;
  source: "clone" | "empty";
}

const MINUTE = 60_000;
const NOW = Date.now();

export const PROJECTS: PlaygroundProject[] = [
  { id: "os", name: "Convoy", alias: "OS", organization: "Contoso", linkedRepo: { fullName: "contoso/convoy", isPrivate: true }, canUpdate: true },
  { id: "web", name: "Marketing site", alias: "WEB", organization: "Contoso", linkedRepo: { fullName: "contoso/landing", isPrivate: false }, canUpdate: true },
  { id: "ops", name: "Ops notes", alias: "OPS", organization: "Contoso", canUpdate: true },
  { id: "docs", name: "Partner docs", alias: "PD", organization: "Acme", canUpdate: false },
];

export const INITIAL_ENVIRONMENTS: PlaygroundEnvironment[] = [
  { id: "devbox", name: "Devcontainer", hostname: "devbox", mode: "shared", isOnline: true, lastSeenAt: NOW - MINUTE, hasGitToken: false, availability: "all", selectedProjectIds: [] },
  { id: "docker", name: "Office Docker", hostname: "convoy-env-office", mode: "isolated", isOnline: true, lastSeenAt: NOW - 2 * MINUTE, hasGitToken: false, availability: "all", selectedProjectIds: [] },
  { id: "laptop", name: "Old laptop", hostname: "robin-mbp", mode: "shared", isOnline: false, lastSeenAt: NOW - 3 * 24 * 60 * MINUTE, hasGitToken: false, availability: "selected", selectedProjectIds: ["os"] },
];

export const INITIAL_REGISTRATIONS: Registration[] = [
  { environmentId: "devbox", projectId: "os", status: "ready", folder: "~/convoy/os", profileKey: "os", source: "clone" },
  { environmentId: "docker", projectId: "os", status: "idle", folder: "os", profileKey: "os", source: "empty" },
  { environmentId: "devbox", projectId: "web", status: "failed", folder: "~/convoy/web", profileKey: "web", source: "clone", error: "GitHub rejected the clone. Run gh auth login on devbox, then retry." },
  { environmentId: "laptop", projectId: "os", status: "ready", folder: "~/code/convoy", profileKey: "os", source: "clone" },
];

export const MODE_COPY: Record<EnvironmentMode, { label: string; description: string }> = {
  shared: { label: "Shared", description: "One account and home folder for all projects. Log into gh and each runtime once. Credentials aren't isolated between projects." },
  isolated: { label: "Isolated", description: "Each project runs as its own user in a sandbox with a private home folder. Credentials come from the environment's managed credentials." },
};

export const STATUS_COPY: Record<RegistrationStatus, string> = {
  pending: "Setting up…",
  ready: "Ready",
  idle: "Idle · starts on the next thread",
  failed: "Setup failed",
};

/** Isolated folders live under the workspace root; shared ones are any path. */
export function defaultSetup(environment: PlaygroundEnvironment, project: PlaygroundProject): SetupInput {
  const key = project.alias.toLowerCase();
  return { folder: environment.mode === "isolated" ? key : `~/convoy/${key}`, profileKey: key, source: project.linkedRepo ? "clone" : "empty" };
}

/** Whether the owner's environment is offered in this project. */
export function isOffered(environment: PlaygroundEnvironment, project: PlaygroundProject) {
  return project.canUpdate && (environment.availability === "all" || environment.selectedProjectIds.includes(project.id));
}

/** Private clones on isolated environments need the environment's GitHub token (slice 5). */
export function needsGitToken(environment: PlaygroundEnvironment, project: PlaygroundProject, source: SetupInput["source"]) {
  return environment.mode === "isolated" && source === "clone" && project.linkedRepo?.isPrivate === true && !environment.hasGitToken;
}

export function formatLastSeen(environment: PlaygroundEnvironment) {
  if (environment.isOnline) return "Online";
  const days = Math.round((Date.now() - environment.lastSeenAt) / (24 * 60 * MINUTE));
  return `Last seen ${days} days ago`;
}
