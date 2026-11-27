#!/usr/bin/env node
// Waits until every `runAll` migration has finished; exits 1 naming one that failed.
// self-hosted/start.sh runs it after the deploy. See docs/specs/automatic-migrations.md.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { runTargetFlags } from "./convexDeploy.mjs";

/** Polls `readStatus` until all migrations are done. Returns null, or why it stopped waiting. */
export async function waitForMigrations(readStatus, { pollMs = 2000, log = console.log } = {}) {
  let idlePolls = 0;
  let lastLine = "";
  for (;;) {
    const statuses = await readStatus();
    const stopped = statuses.find((m) => m.state === "failed" || m.state === "canceled");
    if (stopped) {
      return stopped.state === "failed"
        ? `Data migration ${stopped.name} failed: ${stopped.error ?? "no error recorded"}`
        : `Data migration ${stopped.name} was canceled.`;
    }
    const pending = statuses.filter((m) => !m.isDone);
    if (pending.length === 0) return null;
    // Nothing runs for a moment between two migrations of the series, so one idle poll is normal.
    idlePolls = pending.some((m) => m.state === "inProgress") ? 0 : idlePolls + 1;
    if (idlePolls === 3) {
      return `Data migrations stopped before ${pending[0].name} finished. Deploy again to resume them.`;
    }
    const line = `Waiting for data migration ${pending[0].name} (${pending[0].processed} documents so far)...`;
    if (line !== lastLine) log(line);
    lastLine = line;
    await sleep(pollMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = runTargetFlags(process.env) ?? [];
  const readStatus = async () => {
    const run = spawnSync("npx", ["convex", "run", ...flags, "migrations:runAllStatus"], {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error("Could not read the data migration status.");
    return JSON.parse(run.stdout);
  };
  const failure = await waitForMigrations(readStatus).catch((error) => error.message);
  if (failure) {
    console.error(failure);
    process.exit(1);
  }
  console.log("Data migrations are done.");
}
