#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(currentDir, "..");

const candidates = [
  path.resolve(packageDir, "node_modules/.bin/vitest"),
  path.resolve(packageDir, "../../apps/cli/node_modules/.bin/vitest"),
  path.resolve(packageDir, "../../apps/web/node_modules/.bin/vitest"),
];

const vitestBin = candidates.find((candidate) => existsSync(candidate));

if (!vitestBin) {
  console.error("Unable to find vitest binary. Checked:");
  for (const candidate of candidates) {
    console.error(`- ${candidate}`);
  }
  process.exit(1);
}

const child = spawn(vitestBin, process.argv.slice(2), {
  cwd: packageDir,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
