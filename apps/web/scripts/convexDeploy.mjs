#!/usr/bin/env node
// Pushes the backend, then starts pending data migrations on the same deployment.
// Arguments go to `convex deploy` only. See docs/specs/automatic-migrations.md.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RUN_ALL = "migrations:runAll";

/**
 * Flags that point `convex run` at the deployment `convex deploy` pushes to.
 * Null for a preview deploy key: it names no deployment, so `--preview-run` is the only way in.
 */
export function runTargetFlags(env) {
  const key = env.CONVEX_DEPLOY_KEY ?? "";
  const [prefix, secret] = key.split("|");
  if (secret !== undefined && /^preview:[^:]*:[^:]*$/.test(prefix)) return null;
  // A self-hosted URL or a deployment's own key already fixes the target. Otherwise deploy means prod.
  const fixed = env.CONVEX_SELF_HOSTED_URL || (key && !key.startsWith("project:"));
  return fixed ? [] : ["--prod"];
}

/**
 * Runs `migrations:runAll` and reports whether it started. The runner runs the first batch
 * inside the call and returns a failure as a status, with exit code 0.
 */
export function startMigrations(flags, spawnOptions = {}) {
  const run = spawnSync("npx", ["convex", "run", ...flags, RUN_ALL], {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
    ...spawnOptions,
  });
  process.stdout.write(run.stdout ?? "");
  return run.status === 0 && !/"Status": "Migration failed/.test(run.stdout);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  // Only the deploy would follow these, and migrations would run somewhere else.
  const selector = args.find((arg) => /^--(env-file|url|admin-key)(=|$)/.test(arg));
  if (selector) {
    console.error(`${selector} is not supported. Choose the deployment with environment variables.`);
    process.exit(1);
  }
  // The Convex CLI reads its target from these files too; neither overrides the real environment.
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const deployed = spawnSync("npx", ["convex", "deploy", "--preview-run", RUN_ALL, ...args], { stdio: "inherit" }).status ?? 1;
  // A dry run pushed nothing, so there is nothing to migrate.
  if (deployed !== 0 || args.includes("--dry-run")) process.exit(deployed);

  const flags = runTargetFlags(process.env);
  if (flags === null) {
    console.log("Preview deployment: data migrations start only when the preview is created.");
    process.exit(0);
  }
  if (!startMigrations(flags)) {
    console.error("The backend is deployed, but data migrations did not start. Fix the error above and deploy again.");
    process.exit(1);
  }
  console.log("Data migrations run in the background. Check them with:");
  console.log(`  ${["npx convex run", ...flags, "--component migrations lib:getStatus"].join(" ")}`);
}
