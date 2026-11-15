import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

import { CliExecutionSessionManager } from "../session-manager.js";
import { ProviderRegistry } from "../adapters/provider-registry.js";
import type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderVersionInfo,
  ResolveExecutableContext,
  ResolvedExecutable,
  TransportEventEnvelope,
} from "../types.js";
import { isRecord } from "../adapters/adapter-interface.js";

class NodeJsonStreamAdapter implements ProviderAdapter {
  readonly id = "generic" as const;
  readonly defaultTransportMode = "json-stream" as const;

  async resolveExecutable(
    _ctx: ResolveExecutableContext
  ): Promise<ResolvedExecutable> {
    return {
      command: process.execPath,
      source: "configured",
    };
  }

  async detectVersion(
    _ctx: DetectVersionContext
  ): Promise<ProviderVersionInfo> {
    return {
      raw: process.version,
      normalized: process.version.replace(/^v/, ""),
    };
  }

  async detectCapabilities(
    _ctx: DetectCapabilitiesContext
  ): Promise<ProviderCapabilities> {
    return {
      supportsJsonStream: true,
      supportsResume: false,
      supportsInterrupt: true,
      supportsPty: false,
    };
  }

  async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    const prompt =
      typeof ctx.prompt === "string" && ctx.prompt.length > 0 ? ctx.prompt : "empty";
    const encodedPrompt = JSON.stringify(prompt);

    const script = [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      `const prompt = ${encodedPrompt};`,
      "process.stdin.on('end', () => {",
      "  const payload = {",
      "    type: 'assistant',",
      "    data: `reply:${prompt}:${input.length === 0 ? 'stdin-closed' : 'stdin-open'}`",
      "  };",
      "  process.stdout.write(JSON.stringify(payload) + '\\n');",
      "});",
      "process.stdin.resume();",
    ].join("\n");

    return {
      command: process.execPath,
      args: ["-e", script],
      cwd: ctx.cwd,
      env: ctx.env,
      transportMode: "json-stream" as const,
      detached: false,
      closeStdinAfterSpawn: true,
    };
  }
}

class MissingExecutableAdapter extends NodeJsonStreamAdapter {
  override async resolveExecutable(
    _ctx: ResolveExecutableContext
  ): Promise<ResolvedExecutable> {
    return {
      command: "__convoy_missing_binary__",
      source: "configured",
    };
  }

  override async buildSpawnSpec(ctx: BuildSpawnSpecContext) {
    return {
      command: "__convoy_missing_binary__",
      args: [],
      cwd: ctx.cwd,
      env: ctx.env,
      transportMode: "json-stream" as const,
      detached: false,
      closeStdinAfterSpawn: true,
    };
  }
}

function createRegistry(adapter: ProviderAdapter): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return registry;
}

describe("session manager subprocess smoke", () => {
  it("runs a real local subprocess and captures a json-stream reply", async () => {
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(new NodeJsonStreamAdapter()),
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 5_000,
        idleTimeoutMs: 5_000,
        maxRunTimeoutMs: 15_000,
        terminateGraceMs: 500,
        forceKillGraceMs: 500,
        terminateAfterResultMs: 1_000,
      },
      isolationRootDir: path.join(os.tmpdir(), "convoy-sdk-subprocess-tests"),
      cleanupPolicy: "always",
    });

    const run = await manager.startRun({
      providerId: "generic",
      cwd: process.cwd(),
      prompt: "ping",
      transportMode: "json-stream",
    });

    const events: TransportEventEnvelope[] = [];
    const consume = (async () => {
      for await (const event of run.events()) {
        events.push(event);
      }
    })();

    const finalState = await run.wait();
    await consume;
    await manager.shutdown();

    expect(finalState.status).toBe("completed");

    const stdoutEvent = events.find((event) => event.kind === "stdout");
    expect(stdoutEvent).toBeDefined();

    const payload = stdoutEvent?.payload;
    expect(isRecord(payload)).toBe(true);
    if (!isRecord(payload)) {
      return;
    }

    expect(payload.type).toBe("assistant");
    expect(payload.data).toBe("reply:ping:stdin-closed");
  });

  it("surfaces supervisor handshake spawn failures when provider executable is missing", async () => {
    const manager = new CliExecutionSessionManager({
      providerRegistry: createRegistry(new MissingExecutableAdapter()),
      limits: {
        maxConcurrentRuns: 1,
        maxRunsPerWorkingDir: 1,
        startupTimeoutMs: 5_000,
        idleTimeoutMs: 5_000,
        maxRunTimeoutMs: 15_000,
        terminateGraceMs: 500,
        forceKillGraceMs: 500,
        terminateAfterResultMs: 1_000,
      },
      isolationRootDir: path.join(os.tmpdir(), "convoy-sdk-subprocess-tests"),
      cleanupPolicy: "always",
    });

    await expect(
      manager.startRun({
        providerId: "generic",
        cwd: process.cwd(),
        prompt: "ping",
        transportMode: "json-stream",
      })
    ).rejects.toThrow(/Supervisor spawn failed/i);
  });
});
