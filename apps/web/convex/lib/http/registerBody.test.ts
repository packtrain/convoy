import { describe, expect, test } from "vitest";
import { MIN_SUPPORTED_CLI_VERSION, checkMinSupportedCliVersion, parseRegisterAvailableClis } from "./registerBody";

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: string;
    code: string;
    minVersion: string;
  };
}

describe("checkMinSupportedCliVersion", () => {
  // Workflow bash steps (OS-1886) ship as script requests an older CLI would
  // prompt its agent with; the minimum keeps such CLIs out at register.
  test("the minimum admits the first CLI that runs workflow scripts and nothing older", () => {
    expect(checkMinSupportedCliVersion("0.55.0", MIN_SUPPORTED_CLI_VERSION).success).toBe(true);
    expect(checkMinSupportedCliVersion("0.54.9", MIN_SUPPORTED_CLI_VERSION).success).toBe(false);
  });

  test("passes when version equals the minimum", () => {
    expect(checkMinSupportedCliVersion("0.50.0", "0.50.0").success).toBe(true);
  });

  test("passes when version is newer than the minimum", () => {
    expect(checkMinSupportedCliVersion("0.50.1", "0.50.0").success).toBe(true);
    expect(checkMinSupportedCliVersion("0.51.0", "0.50.9").success).toBe(true);
    expect(checkMinSupportedCliVersion("1.0.0", "0.99.99").success).toBe(true);
  });

  test("rejects an older version with 426 and CLI_UPDATE_REQUIRED", async () => {
    const result = checkMinSupportedCliVersion("0.49.9", "0.50.0");
    if (result.success) throw new Error("expected rejection");
    expect(result.response.status).toBe(426);
    const body = await errorBody(result.response);
    expect(body.code).toBe("CLI_UPDATE_REQUIRED");
    expect(body.minVersion).toBe("0.50.0");
    expect(body.error).toContain("0.49.9");
    expect(body.error).toContain("0.50.0");
    expect(body.error).toContain("npm install -g @useconvoy/cli@latest");
  });

  test("compares segments numerically, not lexicographically", () => {
    expect(checkMinSupportedCliVersion("0.100.0", "0.50.0").success).toBe(true);
  });

  test("treats a missing version as 0.0.0", () => {
    expect(checkMinSupportedCliVersion(undefined, "0.0.0").success).toBe(true);
    expect(checkMinSupportedCliVersion(undefined, "0.50.0").success).toBe(false);
  });

  test("treats a malformed version as 0.0.0", () => {
    expect(checkMinSupportedCliVersion("dev", "0.50.0").success).toBe(false);
  });

  test("ignores prerelease suffixes", () => {
    expect(checkMinSupportedCliVersion("0.50.0-beta.1", "0.50.0").success).toBe(
      true
    );
  });
});

describe("parseRegisterAvailableClis", () => {
  const advertised = [
    { type: "codex", version: "0.142.0" },
    { type: "antigravity", version: "1.5.13" },
  ];
  const types = (appVersion: string | undefined) => {
    const parsed = parseRegisterAvailableClis(advertised, appVersion);
    return parsed.success ? parsed.value?.map((cli) => cli.type) : parsed;
  };

  test("drops a runtime the connecting CLI is too old to run safely", () => {
    // 0.151.0 ignores Ask to approve and would run it with permissions skipped (OS-2469).
    expect(types("0.151.0")).toEqual(["codex"]);
    expect(types(undefined)).toEqual(["codex"]);
    // 0.152.x ignores the selected model and thinking level (OS-2470).
    expect(types("0.152.1")).toEqual(["codex"]);
    // 0.153.x wraps agy's slash commands in the run envelope, so they would reach agy as prose (OS-2471).
    expect(types("0.153.0")).toEqual(["codex"]);
    expect(types("0.154.0")).toEqual(["codex", "antigravity"]);
  });
});
