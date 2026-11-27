#!/usr/bin/env node
// Provisions a Convex preview deployment for a linked git worktree so agents
// can run the app end-to-end without touching the shared dev deployment.
//
// Usage (from the worktree root):
//   node scripts/worktree-setup.mjs          # full setup (wt pre-start hook runs this)
//   node scripts/worktree-setup.mjs deploy   # re-push convex functions after backend edits
//   node scripts/worktree-setup.mjs dev      # devcontainer only: start next dev on the instance URL
//
// Requires CONVEX_PREVIEW_DEPLOY_KEY in apps/web/.env.local (generate a
// "Preview" deploy key in the Convex dashboard project settings; needs Pro).
// See docs/specs/worktree-preview-deployments.md.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { startMigrations } from "../apps/web/scripts/convexDeploy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");
const envPath = path.join(webDir, ".env.local");
const inDevcontainer = process.env.DEVCONTAINER === "true";

const log = (msg) => console.log(`[worktree-setup] ${msg}`);
const fail = (msg) => {
  console.error(`[worktree-setup] ERROR: ${msg}`);
  process.exit(1);
};

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function convexEnv(baseEnv, env = {}) {
  // An inherited CONVEX_DEPLOYMENT beats .env.local; devcontainers inherit prod's.
  const { CONVEX_DEPLOYMENT: _inherited, ...childEnv } = { ...baseEnv, ...env };
  return childEnv;
}

function convex(args, { env = {}, capture = false } = {}) {
  const childEnv = convexEnv(process.env, env);
  const res = spawnSync("npx", ["convex", ...args], {
    cwd: webDir,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    env: childEnv,
  });
  return { ok: res.status === 0, stdout: res.stdout ?? "" };
}

// Preview deploys skip `--preview-run` on an existing deployment, so start them by name.
// See docs/specs/automatic-migrations.md.
function startPreviewMigrations(deploymentName, env) {
  log("starting pending data migrations...");
  if (!startMigrations(["--deployment", deploymentName], { cwd: webDir, env: convexEnv(process.env, env) })) {
    fail("starting data migrations on the preview deployment failed");
  }
}

function readEnvLines() {
  if (!fs.existsSync(envPath)) fail(`missing ${envPath} — was the env file copied into this worktree?`);
  return fs.readFileSync(envPath, "utf8").split("\n");
}

function getEnv(lines, key) {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

/** Unset means convex, as in apps/web/lib/auth/auth-mode.ts. Parsed like dotenv, so quotes and comments match Next. */
export function usesConvexAuth(lines) {
  const mode = parseEnv(lines.join("\n")).NEXT_PUBLIC_AUTH_MODE || "convex";
  if (mode !== "clerk" && mode !== "convex") throw new Error(`NEXT_PUBLIC_AUTH_MODE must be clerk or convex, not "${mode}"`);
  return mode === "convex";
}

function upsertEnv(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

function removeEnv(lines, key) {
  return lines.filter((l) => !l.startsWith(`${key}=`));
}

function writeEnvLines(lines) {
  fs.writeFileSync(envPath, lines.join("\n").replace(/\n+$/, "") + "\n");
}

// Same sanitization portless applies to worktree branch prefixes, so the
// preview name matches the subdomain (feature/foo-bar -> foo-bar). A detached
// HEAD falls back to the worktree folder name.
export function previewSlug(branch, worktreeDir) {
  const name = branch === "HEAD" ? path.basename(worktreeDir) : branch;
  return (name.split("/").pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Devcontainers read dev through a dev-scoped deploy key: a `convex login`
// token would reach every deployment, prod included.
export function devDeployKey(key, devcontainer) {
  if (key && !key.startsWith("dev:")) throw new Error("CONVEX_DEV_DEPLOY_KEY must be a dev: deploy key");
  if (!key && devcontainer) {
    throw new Error(
      "CONVEX_DEV_DEPLOY_KEY is not set. Generate a deploy key on the dev deployment " +
        "(Convex dashboard → dev deployment → Settings) and add it to the primary checkout's apps/web/.env.local."
    );
  }
  return key;
}

/**
 * Convex Auth worktrees: creates the agent user before anyone else can claim its address
 * on the preview, then copies the dev memberships to that user's id
 * (docs/specs/worktree-preview-deployments.md#convex-auth-mode). `run` calls a Convex function.
 */
export function provisionAgentUser({ email, run, newPassword = randomBytes(24).toString("base64url") }) {
  const signUp = run("auth:signUpWithoutEmailVerification", { email, password: newPassword });
  if (signUp?.status === "complete") {
    const copied = run("organizations/members:copyMembershipsFromEmail", { email, toUserId: signUp.tokens.userId });
    if (!copied) throw new Error("copying the dev memberships to the agent user failed. Run setup again; it creates a fresh preview deployment.");
    return { password: newPassword, copied };
  }
  if (signUp?.userError?.error === "EMAIL_TAKEN") {
    throw new Error(
      `an account with ${email} already exists on the preview, so setup will not use it. ` +
        "Run setup again; it creates a fresh preview deployment."
    );
  }
  throw new Error(`creating the agent user failed: ${JSON.stringify(signUp?.userError ?? signUp)}`);
}

function branchSlug() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const slug = previewSlug(branch, repoRoot);
  if (!slug) fail(`cannot derive a preview name from branch "${branch}"`);
  return slug;
}

function requireLinkedWorktree() {
  const gitDir = git("rev-parse", "--absolute-git-dir");
  const commonDir = git("rev-parse", "--git-common-dir");
  if (gitDir === path.resolve(repoRoot, commonDir)) {
    fail("this is the primary checkout, not a linked worktree — refusing to rewrite apps/web/.env.local");
  }
}

function requirePreviewKey(lines) {
  const key = getEnv(lines, "CONVEX_PREVIEW_DEPLOY_KEY");
  if (!key) {
    log("CONVEX_PREVIEW_DEPLOY_KEY is not set in apps/web/.env.local — skipping Convex preview setup.");
    log("Generate a Preview deploy key in the Convex dashboard (Project Settings → Deploy Keys)");
    log("and add CONVEX_PREVIEW_DEPLOY_KEY=preview:... to the primary checkout's apps/web/.env.local.");
    process.exit(0);
  }
  return key;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().once("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function setup() {
  requireLinkedWorktree();
  let lines = readEnvLines();
  const previewKey = requirePreviewKey(lines);
  let convexAuth;
  try {
    convexAuth = usesConvexAuth(lines);
  } catch (error) {
    fail(error.message);
  }

  if (getEnv(lines, "CONVEX_PREVIEW_NAME")) {
    log("CONVEX_PREVIEW_NAME already set — worktree is provisioned. Use `pnpm worktree:convex:deploy` to redeploy.");
    process.exit(0);
  }

  let devKey;
  try {
    devKey = devDeployKey(getEnv(lines, "CONVEX_DEV_DEPLOY_KEY"), inDevcontainer);
  } catch (error) {
    fail(error.message);
  }
  // No key on a host: the personal login plus .env.local's CONVEX_DEPLOYMENT pick dev.
  const devEnv = devKey ? { CONVEX_DEPLOY_KEY: devKey } : {};

  const slug = branchSlug();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-preview-"));
  const snapshotPath = path.join(tmpDir, "dev-snapshot.zip");
  const envDumpPath = path.join(tmpDir, "dev-env");
  const urlPath = path.join(tmpDir, "preview-url");

  // 1. Snapshot the dev deployment (data + env vars) while .env.local still points at it.
  log("exporting data from the dev deployment (including file storage)...");
  if (!convex(["export", "--path", snapshotPath, "--include-file-storage"], { env: devEnv }).ok) {
    fail("convex export from dev failed");
  }
  log("capturing dev deployment environment variables...");
  // Without --include-values the CLI prints names only when it detects an agent.
  // CLIs older than 1.49 lack the flag but print values anyway.
  let envList = convex(["env", "list", "--include-values"], { env: devEnv, capture: true });
  if (!envList.ok) envList = convex(["env", "list"], { env: devEnv, capture: true });
  if (!envList.ok) fail("convex env list on dev failed");
  fs.writeFileSync(envDumpPath, envList.stdout);

  // 2. Detach this worktree from the shared dev deployment before deploying.
  lines = removeEnv(lines, "CONVEX_DEPLOYMENT");
  writeEnvLines(lines);

  // 3. Create the preview deployment. --cmd runs first with the URL exposed,
  //    so we capture it even if the function push fails (e.g. auth.config
  //    needs env vars that don't exist yet — fixed by the env set + retry below).
  log(`creating Convex preview deployment "${slug}"...`);
  const deployArgs = [
    "deploy",
    "--typecheck", "disable",
    "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL",
    "--cmd", `printenv NEXT_PUBLIC_CONVEX_URL > "${urlPath}"`,
  ];
  const firstDeploy = convex([...deployArgs, "--preview-create", slug], {
    env: { CONVEX_DEPLOY_KEY: previewKey },
  });
  if (!fs.existsSync(urlPath)) fail("could not determine preview deployment URL — deploy failed before provisioning");
  const previewUrl = fs.readFileSync(urlPath, "utf8").trim();
  const deploymentName = new URL(previewUrl).hostname.split(".")[0];

  // Devcontainers serve on a container port that OrbStack routes from the Mac
  // (docs/specs/worktree-preview-deployments.md#devcontainer).
  // ponytail: OrbStack-only host; Docker Desktop needs a published port instead.
  const port = inDevcontainer ? await freePort() : undefined;
  const appHost = inDevcontainer ? `${os.hostname()}.orb.local` : `${slug}.app.convoy.localhost`;
  const appUrl = inDevcontainer ? `http://${appHost}:${port}` : `https://${appHost}`;

  // 4. Copy dev env vars (Clerk issuer, secrets, etc.) onto the preview deployment.
  log(`copying dev environment variables to preview deployment ${deploymentName}...`);
  const previewEnv = { CONVEX_DEPLOY_KEY: previewKey };
  if (!convex(["env", "set", "--from-file", envDumpPath, "--force", "--deployment", deploymentName], { env: previewEnv }).ok) {
    fail("copying env vars to the preview deployment failed");
  }
  if (inDevcontainer && !convex(["env", "set", "--deployment", deploymentName, "NEXT_PUBLIC_APP_URL", appUrl], { env: previewEnv }).ok) {
    fail("setting NEXT_PUBLIC_APP_URL on the preview deployment failed");
  }
  // Convex Auth worktree: accounts allowed, and no mailbox needed for the agent user.
  for (const [key, value] of convexAuth ? [["AUTH_MODE", "convex"], ["AUTH_EMAIL_VERIFICATION", "off"]] : []) {
    if (!convex(["env", "set", "--deployment", deploymentName, key, value], { env: previewEnv }).ok) {
      fail(`setting ${key} on the preview deployment failed`);
    }
  }

  // 5. If the first push failed (auth config needed the env vars), push again.
  if (!firstDeploy.ok) {
    log("initial function push failed before env vars existed — redeploying...");
    if (!convex(["deploy", "--typecheck", "disable", "--preview-name", slug], { env: previewEnv }).ok) {
      fail("redeploy to the preview deployment failed");
    }
  }

  // 6. Import the dev snapshot.
  log("importing dev data snapshot into the preview deployment...");
  if (!convex(["import", "--deployment", deploymentName, "--replace-all", "-y", snapshotPath], { env: previewEnv }).ok) {
    fail("data import into the preview deployment failed");
  }
  startPreviewMigrations(deploymentName, previewEnv);

  // 7. Convex Auth: the agent user for /api/agent/browser-login, before the
  //    provisioned marker, so a failure leaves setup to rerun from scratch.
  const agentEmail = getEnv(lines, "CONVOY_AGENT_BROWSER_USER_EMAIL");
  let agent;
  if (convexAuth && agentEmail) {
    log(`creating the agent user ${agentEmail} on the preview deployment...`);
    const run = (fn, args) => {
      const res = convex(["run", "--deployment", deploymentName, fn, JSON.stringify(args)], { env: previewEnv, capture: true });
      return res.ok ? JSON.parse(res.stdout) : null;
    };
    try {
      agent = provisionAgentUser({ email: agentEmail, run });
    } catch (error) {
      fail(error.message);
    }
    log(`  copied ${agent.copied.organizations} organization and ${agent.copied.projects} project memberships`);
  } else if (convexAuth) {
    log("CONVOY_AGENT_BROWSER_USER_EMAIL is not set — skipping the agent user.");
  }

  // 8. Point the worktree's app at the preview deployment.
  lines = readEnvLines();
  lines = removeEnv(lines, "CONVEX_DEPLOYMENT");
  upsertEnv(lines, "NEXT_PUBLIC_CONVEX_URL", previewUrl);
  upsertEnv(lines, "NEXT_PUBLIC_CONVEX_SITE_URL", previewUrl.replace(".convex.cloud", ".convex.site"));
  upsertEnv(lines, "CONVEX_PREVIEW_NAME", slug);
  upsertEnv(lines, "CONVEX_PREVIEW_DEPLOYMENT", deploymentName);
  if (agent) upsertEnv(lines, "CONVOY_AGENT_BROWSER_USER_PASSWORD", agent.password);
  if (inDevcontainer) {
    upsertEnv(lines, "NEXT_PUBLIC_APP_URL", appUrl);
    upsertEnv(lines, "WORKTREE_DEV_PORT", String(port));
  }
  const allowedHosts = getEnv(lines, "CONVOY_AGENT_BROWSER_ALLOWED_HOSTS");
  if (allowedHosts && !allowedHosts.split(",").includes(appHost)) {
    upsertEnv(lines, "CONVOY_AGENT_BROWSER_ALLOWED_HOSTS", `${allowedHosts},${appHost}`);
  }
  writeEnvLines(lines);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  log("done.");
  log(`  App URL:          ${appUrl} (run \`${inDevcontainer ? "pnpm worktree:dev" : "pnpm web:dev"}\` in this worktree)`);
  log(`  Convex preview:   ${deploymentName} (${previewUrl})`);
  log("  Redeploy backend: pnpm worktree:convex:deploy (after editing convex/ functions)");
}

function deploy() {
  requireLinkedWorktree();
  const lines = readEnvLines();
  const previewKey = requirePreviewKey(lines);
  const slug = getEnv(lines, "CONVEX_PREVIEW_NAME");
  if (!slug) fail("CONVEX_PREVIEW_NAME not set — run `node scripts/worktree-setup.mjs` first");
  log(`deploying convex functions to preview deployment "${slug}"...`);
  const previewEnv = { CONVEX_DEPLOY_KEY: previewKey };
  if (!convex(["deploy", "--typecheck", "disable", "--preview-name", slug], { env: previewEnv }).ok) {
    fail("deploy failed");
  }
  startPreviewMigrations(getEnv(lines, "CONVEX_PREVIEW_DEPLOYMENT"), previewEnv);
  log("done.");
}

// No -H 0.0.0.0: next dev already listens on all interfaces, and -H makes
// request.url report 0.0.0.0, which fails the agent browser login host check.
function dev() {
  if (!inDevcontainer) fail("`dev` is for devcontainers; on a host run `pnpm web:dev` (portless).");
  requireLinkedWorktree();
  const lines = readEnvLines();
  const port = getEnv(lines, "WORKTREE_DEV_PORT");
  if (!port) fail("WORKTREE_DEV_PORT not set — run `pnpm worktree:setup` first");
  log(`serving ${getEnv(lines, "NEXT_PUBLIC_APP_URL")}`);
  const res = spawnSync("npx", ["next", "dev", "-p", port], {
    cwd: webDir,
    stdio: "inherit",
    env: convexEnv(process.env),
  });
  process.exit(res.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "setup";
  if (command === "setup") await setup();
  else if (command === "deploy") deploy();
  else if (command === "dev") dev();
  else fail(`unknown command "${command}" (expected: setup, deploy, dev)`);
}
