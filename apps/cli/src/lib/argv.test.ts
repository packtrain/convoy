import { describe, expect, it } from "vitest";
import { normalizeCommandArgv } from "./argv.js";

describe("normalizeCommandArgv", () => {
  it("removes the standalone pnpm argv separator after the script path", () => {
    expect(
      normalizeCommandArgv([
        "node",
        "dist/bin/convoy.js",
        "--",
        "tasks",
        "search",
        "--help",
      ])
    ).toEqual(["node", "dist/bin/convoy.js", "tasks", "search", "--help"]);
  });

  it("leaves normal direct invocations unchanged", () => {
    const argv = ["node", "dist/bin/convoy.js", "tasks", "search", "--help"];
    expect(normalizeCommandArgv(argv)).toEqual(argv);
  });
});
