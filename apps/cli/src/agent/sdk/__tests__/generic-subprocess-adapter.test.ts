import { describe, expect, it } from "vitest";

import { GenericSubprocessAdapter } from "../adapters/generic/generic-subprocess-adapter.js";

describe("generic subprocess adapter", () => {
  it("buildSpawnSpec supports prompt over stdin by default", async () => {
    const adapter = new GenericSubprocessAdapter();
    const spec = await adapter.buildSpawnSpec({
      runId: "run_1",
      cwd: process.cwd(),
      prompt: "run this",
      transportMode: "line-text",
      resolvedExecutable: { command: "/bin/echo", source: "path" },
      version: { raw: "0.0.0", normalized: "0.0.0" },
      capabilities: {
        supportsJsonStream: true,
        supportsResume: false,
        supportsInterrupt: true,
        supportsPty: false,
      },
      env: {},
    });

    expect(spec.bootstrapInput?.[0]).toBe("run this");
  });
});
