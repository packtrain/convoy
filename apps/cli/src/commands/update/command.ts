import { spawnSync } from "node:child_process";
import { Command } from "commander";
import chalk from "chalk";
import { getCliVersion } from "../../lib/version.js";

const INSTALL_ARGS = ["install", "-g", "@useconvoy/cli@latest"];

/** Reinstall the CLI from npm `latest`; returns npm's exit code. See docs/specs/cli-update-notice.md. */
export function runUpdate(): number {
  console.log(
    `Updating @useconvoy/cli ${chalk.dim(`(current: ${getCliVersion()})`)}\n` +
      chalk.dim(`  npm ${INSTALL_ARGS.join(" ")}`)
  );
  // ponytail: assumes a global npm install; add package-manager detection if
  // pnpm/bun users report a wrong command.
  const result = spawnSync("npm", INSTALL_ARGS, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(chalk.red(`Could not run npm: ${result.error.message}`));
    return 1;
  }
  return result.status ?? 1;
}

export const updateCommand = new Command("update")
  .description("Update the Convoy CLI to the latest npm version")
  .action(() => {
    process.exitCode = runUpdate();
  });
