import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Runs start.sh in a temp dir against a fake `docker` that logs its args.
function install(env) {
  const dir = mkdtempSync(join(tmpdir(), "convoy-start-"));
  copyFileSync(new URL("./start.sh", import.meta.url), join(dir, "start.sh"));
  writeFileSync(join(dir, ".env"), env);
  writeFileSync(join(dir, "docker"), `#!/bin/sh\necho "$*" >> "${dir}/docker.log"\n[ -f "${dir}/docker.fail" ] && exit 1\nexit 0\n`);
  chmodSync(join(dir, "docker"), 0o755);
  const run = (input, { dockerFails = false } = {}) => {
    if (dockerFails) writeFileSync(join(dir, "docker.fail"), "");
    else execFileSync("rm", ["-f", join(dir, "docker.fail")]);
    writeFileSync(join(dir, "docker.log"), "");
    const r = spawnSync("bash", [join(dir, "start.sh")], {
      input, encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    return { ...r, out: r.stdout + r.stderr, docker: readFileSync(join(dir, "docker.log"), "utf8") };
  };
  return { run, env: () => readFileSync(join(dir, ".env"), "utf8") };
}

const demoEnv = "INSTANCE_SECRET=x\nCONVEX_SELF_HOSTED_ADMIN_KEY=k\nAUTH_MODE=local-demo\n";

test("a demo install claims the demo user after the deploy", () => {
  const { run } = install(demoEnv);
  const r = run("me@example.com\nhunter22\n\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.docker, /auth:claimDemoUser/);
});

test("a run that fails before the claim asks for the demo account again next time", () => {
  const { run, env } = install(demoEnv);
  assert.notEqual(run("me@example.com\nhunter22\n\n", { dockerFails: true }).status, 0);
  const r = run("me@example.com\nhunter22\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.out, /Give the demo user/);
  assert.match(r.docker, /auth:claimDemoUser/);
  assert.doesNotMatch(env(), /hunter22/);
});

test("skipping the email stops asking", () => {
  const { run } = install(demoEnv);
  assert.equal(run("\n\n").status, 0);
  const r = run("");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.out, /Give the demo user/);
  assert.doesNotMatch(r.docker, /claimDemoUser/);
});

test("the deploy starts data migrations", () => {
  const { run } = install("INSTANCE_SECRET=x\nCONVEX_SELF_HOSTED_ADMIN_KEY=k\nAUTH_MODE=convex\nAUTH_EMAIL_VERIFICATION=off\n");
  const r = run("");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.docker, /node scripts\/convexDeploy\.mjs -y/);
  assert.doesNotMatch(r.docker, /npx convex deploy/);
});
