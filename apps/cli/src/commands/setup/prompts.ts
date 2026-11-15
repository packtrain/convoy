import { input, password, select, Separator } from "@inquirer/prompts";
import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";
import { API_KEY_PREFIX, ENV_URL } from "../../lib/constants.js";
import type { Profile } from "../../lib/config/types.js";

/**
 * Prompt for Convex URL with validation
 */
export async function promptUrl(prefill?: string): Promise<string> {
  return input({
    message: "Convex URL:",
    default: prefill || process.env[ENV_URL] || undefined,
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "Convex URL is required (e.g. https://your-deployment.convex.cloud)";
      }
      try {
        const url = new URL(trimmed);
        return url.protocol === "https:" || "URL must use HTTPS";
      } catch {
        return "Invalid URL format";
      }
    },
  });
}

/**
 * Prompt for the authentication method. Browser login is the interactive
 * default; pasting a key stays available as the manual/CI fallback.
 */
export async function promptAuthMethod(): Promise<"browser" | "paste"> {
  return select({
    message: "How do you want to authenticate?",
    loop: false,
    choices: [
      { name: "Log in with browser (recommended)", value: "browser" as const },
      { name: "Paste an API key", value: "paste" as const },
    ],
  });
}

/**
 * Prompt for API key with masked input and validation
 */
export async function promptApiKey(): Promise<string> {
  return password({
    message: "API Key:",
    mask: "*",
    validate: (value) => {
      if (!value.startsWith(API_KEY_PREFIX)) {
        return `API key must start with '${API_KEY_PREFIX}'`;
      }
      return value.length >= 20 || "API key seems too short";
    },
  });
}

/**
 * Prompt for profile name with validation
 * Profile names are for display - allow spaces and most characters
 */
export async function promptProfileName(prefill?: string): Promise<string> {
  return input({
    message: "Profile name:",
    default: prefill || "default",
    validate: (value) => {
      const trimmed = value.trim();
      if (trimmed.length < 1) return "Name is required";
      if (trimmed.length > 50) return "Name must be 50 characters or less";
      return true;
    },
  });
}

/**
 * Project type for selection prompt
 */
export interface ProjectChoice {
  _id: string;
  name: string;
  alias: string;
  organizationName: string;
}

/**
 * Prompt to select a project from a list, grouped by organization
 */
export async function promptProjectSelect(
  projects: ProjectChoice[],
  allowCreate = false,
): Promise<string> {
  // Group by organization for display
  const byOrg = new Map<string, ProjectChoice[]>();
  for (const p of projects) {
    if (!byOrg.has(p.organizationName)) byOrg.set(p.organizationName, []);
    byOrg.get(p.organizationName)!.push(p);
  }

  const choices: Array<{
    name: string;
    value: string;
    disabled?: string | boolean;
  } | Separator> = [];
  // Create comes first so it never reads as part of the last organization.
  if (allowCreate) choices.push({ name: "+ Create a new project", value: "__create__" }, new Separator());
  for (const [orgName, orgProjects] of byOrg) {
    choices.push({
      name: chalk.bold.dim(`── ${orgName} ──`),
      value: "",
      disabled: " ",
    });
    for (const p of orgProjects) {
      // Format: "Name (ALIAS), proj_xxx"
      choices.push({
        name: `${p.name} ${chalk.dim(`(${p.alias})`)}, ${chalk.dim(p._id)}`,
        value: p._id,
      });
    }
  }

  return select({ message: "Select a project:", choices, loop: false });
}

/**
 * Profile choice for selection
 */
export interface ProfileChoice {
  key: string;
  profile: Profile;
}

/**
 * Result of the three-way "unmatched folder" prompt.
 * - create: run setup wizard
 * - add-folder: add CWD to the chosen profile's paths, then connect
 * - connect-once: connect using the chosen profile without saving the folder
 */
export type UnmatchedFolderResult =
  | { action: "create" }
  | { action: "add-folder"; key: string }
  | { action: "connect-once"; key: string };

/**
 * Prompt when CWD doesn't match any profile.
 * Three-way choice: create new profile / add folder to existing / connect once.
 */
export async function promptUnmatchedFolder(
  profiles: ProfileChoice[]
): Promise<UnmatchedFolderResult> {
  const choices: Array<{
    name: string;
    value: UnmatchedFolderResult;
    disabled?: string | boolean;
  }> = [];

  // Option 1: Create new profile
  choices.push({
    name: chalk.cyan("+ Create new profile"),
    value: { action: "create" },
  });

  // Option 2: Add folder to existing profile
  if (profiles.length > 0) {
    choices.push({
      name: chalk.dim("─ Add folder to existing profile ─"),
      value: { action: "add-folder", key: "" },
      disabled: " ",
    });
    for (const { key, profile } of profiles) {
      const shortUrl = profile.url.replace("https://", "").replace(".convex.cloud", "");
      choices.push({
        name: `  ${profile.name} ${chalk.dim(`(${key})`)} · ${chalk.dim(shortUrl)}`,
        value: { action: "add-folder", key },
      });
    }
  }

  // Option 3: Connect once without saving
  if (profiles.length > 0) {
    choices.push({
      name: chalk.dim("─ Connect once (don't save) ─"),
      value: { action: "connect-once", key: "" },
      disabled: " ",
    });
    for (const { key, profile } of profiles) {
      const shortUrl = profile.url.replace("https://", "").replace(".convex.cloud", "");
      choices.push({
        name: `  ${profile.name} ${chalk.dim(`(${key})`)} · ${chalk.dim(shortUrl)}`,
        value: { action: "connect-once", key },
      });
    }
  }

  return select({
    message: "No profile matches this folder. What would you like to do?",
    choices,
    loop: false,
  });
}

/**
 * Convert a string to a valid profile key (slug)
 * - Lowercase
 * - Replace spaces/underscores with hyphens
 * - Remove invalid characters
 * - Ensure starts with letter
 */
export function toProfileKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-") // spaces/underscores → hyphens
    .replace(/[^a-z0-9-]/g, "") // remove invalid chars
    .replace(/^[^a-z]+/, "") // ensure starts with letter
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/-$/, ""); // remove trailing hyphen
}

/**
 * Prompt for profile key (slug for config file)
 */
export async function promptProfileKey(prefill?: string): Promise<string> {
  const defaultKey = prefill ? toProfileKey(prefill) : undefined;
  return input({
    message: "Profile key (for config file):",
    default: defaultKey,
    validate: (value) =>
      /^[a-z][a-z0-9_-]*$/.test(value) ||
      "Must be lowercase, start with letter, only letters/numbers/hyphens/underscores",
  });
}

export function resolveWorkspacePath(value: string, defaultPath = process.cwd()): string {
  const rawPath = value.trim() || defaultPath;
  return path.resolve(rawPath);
}

export function validateWorkspaceDirectory(value: string): true | string {
  const resolvedPath = resolveWorkspacePath(value);
  try {
    const stats = fs.statSync(resolvedPath);
    return stats.isDirectory() || "Workspace path must be a directory";
  } catch {
    return "Workspace path must exist";
  }
}

export async function promptWorkspacePath(defaultPath: string): Promise<string> {
  const resolvedDefaultPath = path.resolve(defaultPath);
  const value = await input({
    message: `Press Enter to use ${resolvedDefaultPath}, or type another path:`,
    default: resolvedDefaultPath,
    validate: validateWorkspaceDirectory,
  });

  return resolveWorkspacePath(value, resolvedDefaultPath);
}
