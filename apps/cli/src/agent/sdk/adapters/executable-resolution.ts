import { access } from "fs/promises";
import path from "path";
import { constants as fsConstants } from "fs";

import { DEFAULT_PROVIDER_COMMANDS } from "../constants.js";
import type { ProviderConfig, ProviderId, ResolvedExecutable } from "../types.js";

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(command: string): Promise<string | null> {
  const rawPath = process.env.PATH;
  if (!rawPath) return null;

  const separators = process.platform === "win32" ? ";" : ":";
  const dirs = rawPath.split(separators).filter(Boolean);

  const exts = process.platform === "win32"
    ? ["", ".exe", ".cmd", ".bat"]
    : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }

  return null;
}

export async function resolveExecutable(
  providerId: ProviderId,
  config?: ProviderConfig
): Promise<ResolvedExecutable> {
  const configured = config?.executablePath;
  if (configured && (await isExecutable(configured))) {
    return { command: configured, source: "configured" };
  }

  const bundled = config?.bundledBinaryPath;
  if (bundled && (await isExecutable(bundled))) {
    return { command: bundled, source: "bundled" };
  }

  const candidates = config?.commandCandidates ?? DEFAULT_PROVIDER_COMMANDS[providerId] ?? [];
  for (const candidate of candidates) {
    const found = await findOnPath(candidate);
    if (found) {
      return { command: found, source: "path" };
    }
  }

  throw new Error(`Unable to resolve executable for provider ${providerId}`);
}
