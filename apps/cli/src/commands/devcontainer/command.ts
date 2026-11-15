import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { resolveProfile } from "../../lib/config/index.js";
import { addGlobalOptions } from "../../cli.js";
import { configureDevcontainer, convexFirewallHint, installDevcontainerTemplate } from "./install.js";

function printFirewallHint(projectDir: string, profileFlag?: string): void {
  const resolution = resolveProfile(projectDir, { profile: profileFlag });
  if (!resolution.profile) return;

  const hint = convexFirewallHint(resolution.profile.url);
  if (!hint) return;

  if (hint.kind === "deployment") {
    console.log(
      `\nDetected Convoy profile "${resolution.key}". To allowlist its backend in strict network mode, set on your host before starting the container:`
    );
    console.log(chalk.bold(`  export CONVEX_DEPLOYMENT=${hint.value}`));
  } else {
    console.log(
      `\nDetected Convoy profile "${resolution.key}" with a self-hosted backend (${hint.value}). To allowlist it in strict network mode, set on your host before starting the container:`
    );
    console.log(
      chalk.bold(`  export DEVCONTAINER_EXTRA_ALLOWED_DOMAINS=${hint.value}`)
    );
  }
}

export const devcontainerCommand = addGlobalOptions(
  new Command("devcontainer")
    .description(
      "Install the AI agent sandbox dev container template into a project"
    )
    .argument("[dir]", "Project directory (defaults to current directory)")
    .option("--configure", "Configure Convoy MCP inside an existing devcontainer")
    .option("--force", "Overwrite an existing .devcontainer directory")
    .option("--projects", "Install the Linux multi-project template into the parent workspace")
).action(
  async (
    dir: string | undefined,
    options: { force?: boolean; projects?: boolean; configure?: boolean },
    cmd: Command
  ) => {
    try {
      const projectDir = path.resolve(dir ?? process.cwd());
      if (options.configure) {
        const result = configureDevcontainer({ cwd: projectDir, profile: cmd.optsWithGlobals().profile });
        console.log(result.configured
          ? `Configured Codex Convoy MCP using profile "${result.profile}".`
          : "No Convoy profile matches this workspace. Convoy is optional; run convoy setup, then convoy devcontainer --configure to enable MCP.");
        return;
      }
      const result = await installDevcontainerTemplate({
        projectDir,
        force: options.force,
        projects: options.projects,
      });

      const sourceLabel =
        result.source === "github"
          ? "latest from GitHub"
          : "bundled copy (GitHub unreachable)";
      console.log(
        chalk.green("✓") + ` Installed dev container template (${sourceLabel})`
      );
      for (const file of result.files) {
        console.log(chalk.dim(`  ${path.join(result.targetDir, file)}`));
      }
      console.log(
        `\nNext: open the project in VS Code and run ${chalk.bold(
          "Dev Containers: Reopen in Container"
        )}.`
      );
      console.log(
        chalk.dim("See .devcontainer/README.md for env vars and network modes.")
      );
      printFirewallHint(projectDir, cmd.optsWithGlobals().profile);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  }
);
