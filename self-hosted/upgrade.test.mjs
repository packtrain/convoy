import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A fake start.sh that logs the commit it runs at, and fails there when FAIL_AT names it.
const fakeStart = `#!/bin/sh
subject="$(git log -1 --format=%s)"
echo "$subject" >> "$START_LOG"
[ "$subject" = "$FAIL_AT" ] && exit 1
exit 0
`;

/** An origin whose main has `commits` (subject -> stop tag or null), and a clone at the first one. */
function install(commits) {
  const root = mkdtempSync(join(tmpdir(), "convoy-upgrade-"));
  const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
  const origin = join(root, "origin");
  mkdirSync(join(origin, "self-hosted"), { recursive: true });
  git(origin, "init", "-q", "-b", "main");
  copyFileSync(new URL("./upgrade.sh", import.meta.url), join(origin, "self-hosted/upgrade.sh"));
  writeFileSync(join(origin, "self-hosted/start.sh"), fakeStart, { mode: 0o755 });
  writeFileSync(join(origin, ".gitignore"), "self-hosted/.env\n");
  git(origin, "add", "-A");
  const [[first], ...rest] = commits;
  git(origin, "commit", "-q", "-m", first);
  const clone = join(root, "clone");
  git(root, "clone", "-q", origin, clone);
  for (const [subject, tag] of rest) {
    git(origin, "commit", "-q", "--allow-empty", "-m", subject);
    if (tag) git(origin, "tag", "-a", tag, "-m", tag);
  }
  const log = join(root, "start.log");
  const run = (env = {}) => {
    writeFileSync(log, "");
    const r = spawnSync("bash", [join(clone, "self-hosted/upgrade.sh")], {
      encoding: "utf8",
      env: { ...process.env, START_LOG: log, FAIL_AT: "", ...env },
    });
    return { ...r, out: r.stdout + r.stderr, starts: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
  };
  return { run, clone, head: () => git(clone, "log", "-1", "--format=%s") };
}

test("deploys each upgrade stop in order, then main", () => {
  const { run, head } = install([
    ["installed"],
    ["widen a", "upgrade-stop-2026-01-05"],
    ["narrow a"],
    ["widen b", "upgrade-stop-2026-01-05-2"],
    ["narrow b"],
    ["latest"],
  ]);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.starts, ["widen a", "widen b", "latest"]);
  assert.equal(head(), "latest");
});

test("skips stops the install already has", () => {
  const { run } = install([["installed"], ["latest"]]);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.starts, ["latest"]);
});

test("a failed stop stops there, and the next run resumes at it", () => {
  const { run, head } = install([["installed"], ["widen", "upgrade-stop-2026-01-05"], ["latest"]]);
  const failed = run({ FAIL_AT: "widen" });
  assert.notEqual(failed.status, 0);
  assert.deepEqual(failed.starts, ["widen"]);
  assert.equal(head(), "widen");

  const resumed = run();
  assert.equal(resumed.status, 0, resumed.out);
  assert.deepEqual(resumed.starts, ["widen", "latest"]);
});

test("refuses to run over uncommitted changes", () => {
  const { run, clone } = install([["installed"], ["latest"]]);
  writeFileSync(join(clone, "self-hosted/start.sh"), "#!/bin/sh\necho edited\n");
  const r = run();
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.starts, []);
  assert.match(r.out, /uncommitted changes/);
});
