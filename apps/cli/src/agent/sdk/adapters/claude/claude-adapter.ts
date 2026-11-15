import { promisify } from "util";
import { execFile } from "child_process";

import { resolveExecutable } from "../executable-resolution.js";
import type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderVersionInfo,
  ResolveExecutableContext,
  ResolvedExecutable,
  SpawnSpec,
} from "../../types.js";
import { normalizeProviderVersion } from "../../versioning/provider-version.js";

const execFileAsync = promisify(execFile);

async function detectBinaryVersion(command: string): Promise<ProviderVersionInfo> {
  try {
    const result = await execFileAsync(command, ["--version"]);
    const raw = `${result.stdout ?? ""}`.trim() || `${result.stderr ?? ""}`.trim();
    return {
      raw,
      normalized: normalizeProviderVersion(raw),
    };
  } catch {
    return {
      raw: "unknown",
      normalized: "0.0.0",
    };
  }
}

function defaultCapabilities(): ProviderCapabilities {
  return {
    supportsJsonStream: true,
    supportsResume: true,
    supportsInterrupt: true,
    supportsPty: false,
  };
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = "claude" as const;
  readonly defaultTransportMode = "json-stream" as const;

  async resolveExecutable(ctx: ResolveExecutableContext): Promise<ResolvedExecutable> {
    return resolveExecutable(this.id, ctx.providerConfig);
  }

  async detectVersion(ctx: DetectVersionContext): Promise<ProviderVersionInfo> {
    return detectBinaryVersion(ctx.resolvedExecutable.command);
  }

  async detectCapabilities(
    _ctx: DetectCapabilitiesContext
  ): Promise<ProviderCapabilities> {
    return defaultCapabilities();
  }

  async buildSpawnSpec(ctx: BuildSpawnSpecContext): Promise<SpawnSpec> {
    const prompt = typeof ctx.prompt === "string" ? ctx.prompt.trim() : "";

    const resumeSessionId =
      typeof ctx.providerOptions?.resumeSessionId === "string"
        ? ctx.providerOptions.resumeSessionId
        : undefined;

    const permissionMode =
      typeof ctx.providerOptions?.permissionMode === "string" &&
      ctx.providerOptions.permissionMode.trim().length > 0
        ? ctx.providerOptions.permissionMode.trim()
        : undefined;
    const inputFormat =
      ctx.providerOptions?.inputFormat === "stream-json"
        ? "stream-json"
        : "prompt";
    const bootstrapInput = Array.isArray(ctx.providerOptions?.bootstrapInput)
      ? ctx.providerOptions.bootstrapInput
      : undefined;

    if (inputFormat === "prompt" && !prompt) {
      throw new Error("Claude runs require a non-empty prompt");
    }

    if (inputFormat === "stream-json" && (!bootstrapInput || bootstrapInput.length === 0)) {
      throw new Error("Claude stream-json input requires bootstrapInput frames");
    }

    const args =
      inputFormat === "stream-json"
        ? ["--input-format", "stream-json"]
        : ["-p", prompt];

    if (permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    } else if (permissionMode) {
      args.push("--permission-mode", permissionMode);
    } else {
      args.push("--dangerously-skip-permissions");
    }

    args.push("--verbose", "--output-format", "stream-json");

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId, "--fork-session");
    }

    if (Array.isArray(ctx.providerOptions?.additionalArgs)) {
      args.push(
        ...ctx.providerOptions.additionalArgs.filter(
          (arg): arg is string => typeof arg === "string" && arg.length > 0
        )
      );
    }

    return {
      command: ctx.resolvedExecutable.command,
      args,
      cwd: ctx.cwd,
      env: ctx.env,
      transportMode: "json-stream" as const,
      detached: true,
      bootstrapInput: inputFormat === "stream-json" ? bootstrapInput : undefined,
      // Claude runs are single-shot in this integration; close stdin after bootstrap frames.
      closeStdinAfterSpawn: true,
    };
  }
}
