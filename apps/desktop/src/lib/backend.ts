import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * Typed bridge to the Rust commands (src-tauri/src/{config,agents,supervisor}.rs)
 * and to the backend's CLI login HTTP endpoints. HTTP goes through the Tauri
 * http plugin because the Convex login routes have no CORS headers.
 */

// ---------- config ----------

export interface ProfileInfo {
  key: string;
  name: string;
  url: string;
  apiKey: string;
  projectId: string;
  paths: string[];
  streaming?: boolean | null;
  isolated?: boolean | null;
  concurrency?: number | null;
  providerKey?: string | null;
  /** Codex's own assignment (Bedrock/Mantle with a region), independent of `providerKey`. */
  codexProviderKey?: string | null;
}

/**
 * A `[keys.<name>]` entry in config.toml — a local Bedrock/Mantle credential,
 * or a credential-free `anthropic` entry pinning this machine's Claude sign-in.
 */
export interface ProviderKeyInfo {
  name: string;
  provider: "bedrock" | "mantle" | "anthropic" | string;
  token?: string | null;
  region?: string | null;
}

export interface ConfigInfo {
  profiles: ProfileInfo[];
  defaultProfile?: string | null;
  keys: ProviderKeyInfo[];
}

export function loadConfig(): Promise<ConfigInfo> {
  return invoke<ConfigInfo>("load_config");
}

export function saveProfile(args: {
  name: string;
  url: string;
  apiKey: string;
  projectId: string;
  paths: string[];
  profileKey?: string | null;
  streaming?: boolean | null;
  isolated?: boolean | null;
  concurrency?: number | null;
}): Promise<{ key: string }> {
  return invoke<{ key: string }>("save_profile", { args });
}

export function setDefaultProfile(key: string): Promise<void> {
  return invoke<void>("set_default_profile", { key });
}

export function saveProviderKey(args: {
  name: string;
  provider: "bedrock" | "mantle" | "anthropic";
  /** Ignored for `anthropic`, which stores no credential. */
  token: string;
  region?: string | null;
}): Promise<void> {
  return invoke<void>("save_provider_key", args);
}

/** Fails while any profile still references the key. */
export function deleteProviderKey(name: string): Promise<void> {
  return invoke<void>("delete_provider_key", { name });
}

/** `keyName: null` clears the runtime's assignment (back to the machine's own config). */
export function setProfileProviderKey(
  profileKey: string,
  keyName: string | null,
  runtime: "claude-code" | "codex" = "claude-code"
): Promise<void> {
  return invoke<void>("set_profile_provider_key", { profileKey, keyName, runtime });
}

/** macOS: false switches to tray-only (ActivationPolicy::Accessory), applied live. */
export function setDockIconVisible(visible: boolean): Promise<void> {
  return invoke<void>("set_dock_icon_visible", { visible });
}

/** Opens ~/.config/convoy/config.toml in the default editor. */
export function openConfigFile(): Promise<void> {
  return invoke<void>("open_config_file");
}

// ---------- tray (OS-1237) ----------

/** Tray state text: title renders next to the icon, tooltip on hover. Empty clears. */
export function setTrayStatus(title: string, tooltip: string): Promise<void> {
  return invoke<void>("set_tray_status", { title, tooltip });
}

/** One entry of the native tray menu; the webview owns the menu content. */
export interface TrayMenuEntry {
  kind: "item" | "header" | "separator";
  id?: string;
  text?: string;
  /** Gray second line inside the row (NSMenuItem.subtitle, macOS 14.4+). */
  subtext?: string;
}

/** Replaces the native tray menu. Static ids (open-web, settings, quit) are
 * handled in Rust; any other id comes back via the "tray-menu-action" event. */
export function setTrayMenu(entries: TrayMenuEntry[]): Promise<void> {
  return invoke<void>("set_tray_menu", { entries });
}

// ---------- agents ----------

export type AgentKind = "claude-code" | "codex" | "opencode" | "cursor";

export interface AgentStatus {
  kind: AgentKind;
  installed: boolean;
  version?: string | null;
}

export function detectAgents(): Promise<AgentStatus[]> {
  return invoke<AgentStatus[]>("detect_agents");
}

export function installAgent(kind: AgentKind): Promise<{ ok: boolean; error?: string | null }> {
  return invoke<{ ok: boolean; error?: string | null }>("install_agent", { kind });
}

// ---------- supervisor ----------

/** `verboseLogging` sets CONVOY_CLI_DEBUG=1 on the child (Advanced toggle):
 * a log line per stream chunk, so it is off unless the user asks for it. */
export function startAgent(
  profileKey: string,
  cliBin?: string,
  verboseLogging?: boolean
): Promise<{ ok: boolean; error?: string | null }> {
  return invoke<{ ok: boolean; error?: string | null }>("start_agent", {
    profileKey,
    cliBin,
    verboseLogging,
  });
}

/** Profile keys the user stopped on purpose (OS-1240): the tray engine skips
 * the "agent disconnected" notification for these. */
export const expectedAgentStops = new Set<string>();

export function stopAgent(profileKey: string): Promise<void> {
  expectedAgentStops.add(profileKey);
  return invoke<void>("stop_agent", { profileKey });
}

/** Profile keys with a live `convoy connect` child (OS-1274: one per profile). */
export function runningAgents(): Promise<string[]> {
  return invoke<string[]>("running_agents");
}

export interface LocalAgentInfo {
  /** Stable only while the underlying process identity is alive. */
  id: string;
  pid: number;
  processGroupId: number;
  profileKey?: string | null;
  workingDirectory?: string | null;
  startedAt: string;
  processCount: number;
  managed: boolean;
}

/** Every `convoy connect` process group visible on the local machine. */
export function listLocalAgents(): Promise<LocalAgentInfo[]> {
  return invoke<LocalAgentInfo[]>("list_local_agents");
}

/** Revalidates the local process identity before stopping it. */
export function stopLocalAgent(agent: Pick<LocalAgentInfo, "id" | "profileKey">): Promise<void> {
  if (agent.profileKey) expectedAgentStops.add(agent.profileKey);
  return invoke<void>("stop_local_agent", { id: agent.id });
}

/** Tail of ~/.config/convoy/desktop-agent.log (child stdout+stderr). */
export function readAgentLog(): Promise<string> {
  return invoke<string>("read_agent_log");
}

// ---------- browser login (mirrors apps/cli/src/lib/browser-login.ts) ----------

const POLL_INTERVAL_MS = 2_000;
/** Server TTL is 10 min; cap locally so a hostile expiresAt can't run forever. */
const MAX_WAIT_MS = 15 * 60 * 1000;
/** Shown as the API key label in the web app ("CLI login (…)"). */
const LOGIN_HOSTNAME = "Convoy Desktop";

export function normalizeConvexUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Convex queries use *.convex.cloud; HTTP routes live on *.convex.site (self-hosted: port 3211). */
export function toConvexSiteUrl(cloudUrl: string): string {
  if (cloudUrl.includes(".convex.cloud")) {
    return cloudUrl.replace(".convex.cloud", ".convex.site");
  }
  return cloudUrl.replace(/:3210(\/|$)/, ":3211$1");
}

export interface LoginStart {
  challengeId: string;
  userCode: string;
  loginUrl: string;
  deviceUrl: string;
  expiresAt: number;
  verifier: string;
}

export type LoginOutcome =
  | { status: "approved"; apiKey: string; email: string }
  | { status: "denied" }
  | { status: "expired" };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await tauriFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    connectTimeout: 15_000,
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export async function startBrowserLogin(convexUrl: string): Promise<LoginStart> {
  const siteUrl = toConvexSiteUrl(normalizeConvexUrl(convexUrl));

  const verifier = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const verifierHash = toHex(new Uint8Array(hashBytes));

  const raw = (await postJson(`${siteUrl}/api/cli/login/start`, {
    verifierHash,
    hostname: LOGIN_HOSTNAME,
  })) as Record<string, unknown> | undefined;

  if (
    !raw ||
    typeof raw.challengeId !== "string" ||
    typeof raw.userCode !== "string" ||
    typeof raw.loginUrl !== "string" ||
    typeof raw.deviceUrl !== "string" ||
    typeof raw.expiresAt !== "number"
  ) {
    throw new Error("Server returned an unexpected login response");
  }

  return {
    challengeId: raw.challengeId,
    userCode: raw.userCode,
    loginUrl: raw.loginUrl,
    deviceUrl: raw.deviceUrl,
    expiresAt: raw.expiresAt,
    verifier,
  };
}

/** Poll until approved/denied/expired. `signal` aborts between polls (user cancel). */
export async function pollBrowserLogin(
  convexUrl: string,
  start: LoginStart,
  signal: AbortSignal
): Promise<LoginOutcome> {
  const siteUrl = toConvexSiteUrl(normalizeConvexUrl(convexUrl));
  const deadline = Math.min(start.expiresAt, Date.now() + MAX_WAIT_MS);

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    if (signal.aborted) return { status: "expired" };

    let raw: unknown;
    try {
      raw = await postJson(`${siteUrl}/api/cli/login/poll`, {
        challengeId: start.challengeId,
        verifier: start.verifier,
      });
    } catch {
      continue; // transient network blips must not kill a 10-minute flow
    }

    const record = (raw ?? {}) as Record<string, unknown>;
    if (record.status === "pending") continue;
    if (record.status === "approved" && typeof record.apiKey === "string") {
      return { status: "approved", apiKey: record.apiKey, email: String(record.email ?? "") };
    }
    if (record.status === "denied") return { status: "denied" };
    break; // expired / not_found / malformed terminal payload
  }

  return { status: "expired" };
}
