import { access } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { createIsolationEnv } from "../runtime/isolation-env.js";

describe("isolation env", () => {
  it("creates per-run HOME and XDG paths", async () => {
    const context = await createIsolationEnv({
      runId: "run-isolation-test",
      rootDir: path.join(os.tmpdir(), "convoy-sdk-tests"),
      baseEnv: { FOO: "bar", CONVOY_API_KEY: "secret" },
      denylist: ["CONVOY_API_KEY"],
    });

    expect(typeof context.env.HOME).toBe("string");
    expect(context.env.CONVOY_API_KEY).toBeUndefined();
    expect(context.env.FOO).toBe("bar");

    await access(context.homeDir);
    await context.cleanup();
  });
});
