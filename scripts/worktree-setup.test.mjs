import assert from "node:assert/strict";
import test from "node:test";

import { convexEnv, devDeployKey, previewSlug } from "./worktree-setup.mjs";

test("convexEnv drops an inherited CONVEX_DEPLOYMENT so .env.local picks the deployment", () => {
  const env = convexEnv({ CONVEX_DEPLOYMENT: "brave-fox-456", PATH: "/bin" });
  assert.equal(env.CONVEX_DEPLOYMENT, undefined);
  assert.equal(env.PATH, "/bin");
});

test("previewSlug sanitizes the branch, or the worktree folder on a detached HEAD", () => {
  assert.equal(previewSlug("feature/OS-12_Foo", "/w/x"), "os-12-foo");
  assert.equal(previewSlug("HEAD", "/workspace-worktrees/devinstance-probe"), "devinstance-probe");
});

test("devDeployKey accepts only dev: keys and requires one in a devcontainer", () => {
  assert.equal(devDeployKey("dev:happy-otter-123|abc", true), "dev:happy-otter-123|abc");
  assert.equal(devDeployKey(undefined, false), undefined);
  assert.throws(() => devDeployKey("prod:brave-fox-456|abc", true), /dev:/);
  assert.throws(() => devDeployKey(undefined, true), /CONVEX_DEV_DEPLOY_KEY/);
});
