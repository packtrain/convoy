import { describe, expect, it } from "vitest";

import { CodexAdapter } from "../adapters/codex/codex-adapter.js";

describe("codex adapter", () => {
  it("falls back to line transport if json unsupported", async () => {
    const adapter = new CodexAdapter();

    const spec = await adapter.buildSpawnSpec({
      runId: "run_1",
      cwd: process.cwd(),
      prompt: "hello",
      transportMode: "json-stream",
      resolvedExecutable: { command: "/bin/codex", source: "path" },
      version: { raw: "1.0.0", normalized: "1.0.0" },
      capabilities: {
        supportsJsonStream: false,
        supportsResume: false,
        supportsInterrupt: true,
        supportsPty: false,
      },
      env: {},
    });

    expect(spec.transportMode).toBe("line-text");
  });
});
