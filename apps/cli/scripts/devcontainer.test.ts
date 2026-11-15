import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("starts without a hardcoded deployment when the container can resolve its profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "convoy-launch-"));
  try {
    const cli = join(dir, "devcontainer");
    writeFileSync(cli, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_CALLS"\n'); chmodSync(cli, 0o755);
    const calls = join(dir, "calls");
    const result = spawnSync("bash", [resolve(import.meta.dirname, "../../../scripts/devcontainer.sh")], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CONVEX_DEPLOYMENT: "", TEST_CALLS: calls }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(calls, "utf8")).toBe("up\nexec\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("firewall hostname loading treats generated input as data", () => {
  const dir = mkdtempSync(join(tmpdir(), "convoy-domains-"));
  try {
    writeFileSync(join(dir, "convoy-domains"), "api.example.com\n$(touch unexpected)\nother.example.com\n");
    for (const folder of [".devcontainer", "templates/devcontainer"]) {
      const source = readFileSync(resolve(import.meta.dirname, "../../../", folder, "init-firewall.sh"), "utf8");
      const fn = source.match(/add_convoy_domains\(\) \{[\s\S]*?\n\}/)?.[0];
      expect(fn).toBeDefined();
      const result = execFileSync("bash", ["-c", `${fn}\nALLOWED_DOMAINS=()\nadd_convoy_domains\nprintf '%s\\n' "\${ALLOWED_DOMAINS[@]}"`], {
        cwd: dir, env: { ...process.env, CODEX_HOME: dir }, encoding: "utf8",
      });
      expect(result).toBe("api.example.com\nother.example.com\n");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
