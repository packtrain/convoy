import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runTargetFlags } from "./convexDeploy.mjs";

const script = join(__dirname, "convexDeploy.mjs");

type Options = { env?: Record<string, string>; failOn?: string; envLocal?: string; runOutput?: string };

/** Runs the script in an empty dir against a fake `npx` that logs its args, fails on `failOn`, and prints `runOutput` for `convex run`. */
function deploy(args: string[], { env = {}, failOn = "nothing", envLocal, runOutput = '{ "Status": "Migration started." }' }: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "convoy-deploy-"));
  if (envLocal) writeFileSync(join(dir, ".env.local"), envLocal);
  writeFileSync(join(dir, "run-output"), runOutput);
  writeFileSync(
    join(dir, "npx"),
    `#!/bin/sh\necho "$*" >> "${dir}/npx.log"\ncase "$2" in ${failOn}) exit 3;; esac\n[ "$2" = run ] && cat "${dir}/run-output"\nexit 0\n`,
  );
  chmodSync(join(dir, "npx"), 0o755);
  // Only `env` selects the target, whatever the machine running the tests has set.
  const base = { ...process.env };
  delete base.CONVEX_DEPLOY_KEY;
  delete base.CONVEX_SELF_HOSTED_URL;
  const result = spawnSync("node", [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...base, ...env, PATH: `${dir}:${process.env.PATH}` },
  });
  const log = join(dir, "npx.log");
  return { ...result, calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [] };
}

describe("convexDeploy", () => {
  test("runs migrations where the deploy went", () => {
    expect(runTargetFlags({})).toEqual(["--prod"]);
    expect(runTargetFlags({ CONVEX_DEPLOY_KEY: "project:team:app|secret" })).toEqual(["--prod"]);
    expect(runTargetFlags({ CONVEX_DEPLOY_KEY: "prod:friendly-wolf-872|secret" })).toEqual([]);
    expect(runTargetFlags({ CONVEX_DEPLOY_KEY: "preview:shy-cat-1|secret" })).toEqual([]);
    expect(runTargetFlags({ CONVEX_SELF_HOSTED_URL: "http://backend:3210" })).toEqual([]);
    expect(runTargetFlags({ CONVEX_DEPLOY_KEY: "preview:team:app|secret" })).toBeNull();
  });

  test("deploys with the given arguments, then starts migrations without them", () => {
    const r = deploy(["--cmd", "next build", "-y"]);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      "convex deploy --preview-run migrations:runAll --cmd next build -y",
      "convex run --prod migrations:runAll",
    ]);
    expect(r.stdout).toContain("npx convex run --prod --component migrations lib:getStatus");
  });

  test("a failed deploy starts no migrations", () => {
    const r = deploy([], { failOn: "deploy" });
    expect(r.status).toBe(3);
    expect(r.calls).toEqual(["convex deploy --preview-run migrations:runAll"]);
  });

  test("a dry run starts no migrations", () => {
    const r = deploy(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["convex deploy --preview-run migrations:runAll --dry-run"]);
  });

  test("fails when migrations cannot start", () => {
    const r = deploy([], { env: { CONVEX_SELF_HOSTED_URL: "http://backend:3210" }, failOn: "run" });
    expect(r.status).toBe(1);
    expect(r.calls[1]).toBe("convex run migrations:runAll");
    expect(r.stderr).toContain("data migrations did not start");
  });

  // The runner runs the first batch inside the call and returns its failure with exit code 0.
  test("fails when the first batch of a migration fails", () => {
    const r = deploy([], { runOutput: '{\n  "Status": "Migration failed: boom",\n  "Name": "migrations:a"\n}' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Migration failed: boom");
    expect(r.stderr).toContain("data migrations did not start");
  });

  // Node itself exits on a missing --env-file, so the value is a file that exists.
  test.each([["--env-file", script], [`--env-file=${script}`], ["--url", "x"], ["--admin-key", "x"]])("refuses %s, which only the deploy would follow", (...args) => {
    const r = deploy(args);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stderr).toContain("environment variables");
  });

  test("a preview deploy key leaves migrations to --preview-run", () => {
    const r = deploy([], { env: { CONVEX_DEPLOY_KEY: "preview:team:app|secret" } });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["convex deploy --preview-run migrations:runAll"]);
  });

  test("reads the target from .env.local like the Convex CLI does", () => {
    const r = deploy([], { envLocal: "CONVEX_SELF_HOSTED_URL=http://backend:3210\n" });
    expect(r.calls[1]).toBe("convex run migrations:runAll");
  });
});
