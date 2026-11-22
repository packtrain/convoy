import assert from "node:assert/strict";
import test from "node:test";

import { convexEnv, devDeployKey, previewSlug, provisionAgentUser } from "./worktree-setup.mjs";

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

function fakeRun(results) {
  const calls = [];
  const run = (fn, args) => {
    calls.push({ fn, args });
    return typeof results[fn] === "function" ? results[fn](args) : results[fn] ?? null;
  };
  return { run, calls };
}

test("provisionAgentUser signs the agent up with a new password and copies memberships to that user id", () => {
  const { run, calls } = fakeRun({
    "auth:signUpWithoutEmailVerification": { status: "complete", tokens: { userId: "user_new" } },
    "organizations/members:copyMembershipsFromEmail": { organizations: 2, projects: 3 },
  });

  const result = provisionAgentUser({ email: "agent@example.com", newPassword: "fresh", run });

  assert.deepEqual(result, { password: "fresh", copied: { organizations: 2, projects: 3 } });
  assert.deepEqual(calls[0].args, { email: "agent@example.com", password: "fresh" });
  assert.deepEqual(calls[1].args, { email: "agent@example.com", toUserId: "user_new" });
});

test("provisionAgentUser stops on a taken address, even one the dev password signs in to, and copies nothing", () => {
  const { run, calls } = fakeRun({
    "auth:signUpWithoutEmailVerification": { status: "error", userError: { error: "EMAIL_TAKEN" } },
    "auth:signInWithEmailPassword": { status: "complete" },
  });

  assert.throws(
    () => provisionAgentUser({ email: "agent@example.com", newPassword: "fresh", run }),
    /already exists.*Run setup again; it creates a fresh preview deployment/
  );
  assert.deepEqual(
    calls.map((call) => call.fn),
    ["auth:signUpWithoutEmailVerification"]
  );
});

test("provisionAgentUser stops on any other sign-up failure", () => {
  const { run } = fakeRun({ "auth:signUpWithoutEmailVerification": null });

  assert.throws(() => provisionAgentUser({ email: "agent@example.com", newPassword: "fresh", run }), /agent user/);
});

test("provisionAgentUser stops when the membership copy fails, and says a rerun starts fresh", () => {
  const { run } = fakeRun({
    "auth:signUpWithoutEmailVerification": { status: "complete", tokens: { userId: "user_new" } },
    "organizations/members:copyMembershipsFromEmail": null,
  });

  assert.throws(
    () => provisionAgentUser({ email: "agent@example.com", newPassword: "fresh", run }),
    /copying.*Run setup again; it creates a fresh preview deployment/
  );
});
