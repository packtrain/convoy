import { promisify } from "util";
import { execFile } from "child_process";

import { resolveExecutable } from "../executable-resolution.js";
import type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  HandleInputContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderVersionInfo,
  ResolveExecutableContext,
  ResolvedExecutable,
} from "../../types.js";
import { normalizeProviderVersion } from "../../versioning/provider-version.js";

const execFileAsync = promisify(execFile);

async function detectVersion(command: string): Promise<ProviderVersionInfo> {
  try {
    const res = await execFileAsync(command, ["--version"]);
    const raw = `${res.stdout ?? ""}`.trim() || `${res.stderr ?? ""}`.trim();
    return { raw, normalized: normalizeProviderVersion(raw) };
  } catch {
    return { raw: "unknown", normalized: "0.0.0" };
  }
}

async function detectJsonSupport(command: string): Promise<boolean> {
  try {
    const res = await execFileAsync(command, ["--help"]);
    const text = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.toLowerCase();
    return text.includes("--json") || text.includes("jsonl") || text.includes("stream-json");
  } catch {
    return false;
  }
}

export class CodexAdapter implements ProviderAdapter {
  readonly id = "codex" as const;
  readonly defaultTransportMode = "json-stream" as const;

  async resolveExecutable(ctx: ResolveExecutableContext): Promise<ResolvedExecutable> {
    return resolveExecutable(this.id, ctx.providerConfig);
  }

  async detectVersion(ctx: DetectVersionContext): Promise<ProviderVersionInfo> {
    return detectVersion(ctx.resolvedExecutable.command);
  }

  async detectCapabilities(
    ctx: DetectCapabilitiesContext
  ): Promise<ProviderCapabilities> {
    const supportsJsonStream = await detectJsonSupport(ctx.resolvedExecutable.command);
    return {
      supportsJsonStream,
      supportsResume: false,
      supportsInterrupt: true,
      supportsPty: false,
    };
  }

  async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    const requestedTransport = ctx.transportMode;
    const effectiveTransport =
      requestedTransport === "json-stream" && !ctx.capabilities.supportsJsonStream
        ? "line-text"
        : requestedTransport;

    const args = [
      ...(ctx.resolvedExecutable.argsPrefix ?? []),
      ...(Array.isArray(ctx.providerOptions?.args)
        ? (ctx.providerOptions.args.filter((a): a is string => typeof a === "string") as string[])
        : []),
    ];

    if (effectiveTransport === "json-stream") {
      const jsonFlag =
        typeof ctx.providerOptions?.jsonFlag === "string"
          ? ctx.providerOptions.jsonFlag
          : "--json";
      args.push(jsonFlag);
    }

    if (ctx.prompt) {
      args.push(ctx.prompt);
    }

    return {
      command: ctx.resolvedExecutable.command,
      args,
      cwd: ctx.cwd,
      env: {
        ...ctx.env,
        ...ctx.providerConfig?.envOverrides,
      },
      transportMode: effectiveTransport,
      detached: true,
    };
  }

  async handleInput(ctx: HandleInputContext): Promise<void> {
    if (!ctx.child.stdin || ctx.child.stdin.destroyed) return;

    if (ctx.input.type === "stdin_line") {
      ctx.child.stdin.write(`${ctx.input.line}\n`);
      return;
    }

    if (ctx.input.type === "user_text") {
      ctx.child.stdin.write(`${ctx.input.text}\n`);
      return;
    }

    ctx.child.stdin.write(`${JSON.stringify(ctx.input.payload)}\n`);
  }
}
