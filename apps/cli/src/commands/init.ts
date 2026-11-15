import { Command } from "commander";
import chalk from "chalk";
import { CONVOY_SKILLS_SH_INSTALL_COMMAND } from "../lib/skill-install-guidance.js";
import { resolveConfigFromProfileCommand } from "../lib/config/index.js";
import {
  CLAUDE_METHODS,
  INIT_SCOPES,
  INIT_TARGETS,
  InitError,
  parseClaudeMethods,
  parseCliTargets,
  parseScope,
  resolveSkillTargets,
  runInitMcp,
  runInitSkill,
} from "./init/index.js";

function handleInitError(error: unknown): never {
  if (error instanceof InitError) {
    console.error(chalk.red(`\n  ${error.message}`));
  } else {
    console.error(
      chalk.red(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
  process.exit(1);
}

const mcpSubcommand = new Command("mcp")
  .description(
    "Create/update MCP server config for selected CLI targets (.mcp.json and/or .codex/config.toml)"
  )
  .option(
    "-o, --output-dir <path>",
    "Directory to write MCP config files (default: cwd)"
  )
  .option("-f, --force", "Overwrite existing config without prompting")
  .option(
    "--cli <target...>",
    `CLI target(s): ${INIT_TARGETS.join(", ")} (repeat or comma-separate; default: all)`
  )
  .action(
    async (
      options: { outputDir?: string; force?: boolean; cli?: string | string[] },
      cmd: Command
    ) => {
      const cwd = options.outputDir || process.cwd();
      const config = resolveConfigFromProfileCommand(cmd, cwd);
      const parsedCliTargets = parseCliTargets(options.cli);
      const cliTargets =
        parsedCliTargets && parsedCliTargets.length > 0
          ? parsedCliTargets
          : INIT_TARGETS;

      if (!config.convexUrl || !config.apiKey || !config.projectId) {
        console.error(chalk.red("\nMissing required configuration:"));
        if (!config.convexUrl) console.error("  - Convex URL");
        if (!config.apiKey) console.error("  - API Key");
        if (!config.projectId) console.error("  - Project ID");
        console.log(
          chalk.dim(
            "\nRun 'convoy setup' first, or pass --url, --api-key, --project."
          )
        );
        process.exit(1);
      }

      try {
        await runInitMcp({
          convexUrl: config.convexUrl,
          apiKey: config.apiKey,
          projectId: config.projectId,
          outputDir: options.outputDir,
          force: options.force,
          cliTargets,
        });
      } catch (error) {
        handleInitError(error);
      }
    }
  );

const skillSubcommand = new Command("skill")
  .description("Install Convoy skills for Claude Code and/or Codex")
  .option(
    "--cli <target...>",
    `CLI target(s): ${INIT_TARGETS.join(", ")} (repeat or comma-separate)`
  )
  .option(
    "-s, --scope <scope>",
    `Installation scope: ${INIT_SCOPES.join(", ")} (prompts if omitted)`,
    undefined
  )
  .option("-f, --force", "Overwrite existing skill files without prompting")
  .option(
    "--claude-method <method...>",
    `Claude install method(s): ${CLAUDE_METHODS.join(", ")} (repeat or comma-separate)`,
    undefined
  )
  .addHelpText(
    "after",
    `\nAlternative skills.sh installer:\n  ${CONVOY_SKILLS_SH_INSTALL_COMMAND}\n`
  )
  .action(
    async (options: {
      cli?: string | string[];
      scope?: string;
      force?: boolean;
      claudeMethod?: string | string[];
    }) => {
      try {
        const cliTargets = parseCliTargets(options.cli);
        const scope = parseScope(options.scope);
        const claudeMethods =
          cliTargets && !cliTargets.includes("claude")
            ? undefined
            : parseClaudeMethods(options.claudeMethod);
        await runInitSkill({
          cliTargets,
          scope,
          force: options.force,
          claudeMethods,
        });
      } catch (error) {
        handleInitError(error);
      }
    }
  );

export const initCommand = new Command("init")
  .description("Initialize Convoy integrations (MCP config + CLI skills)")
  .enablePositionalOptions()
  .addCommand(mcpSubcommand)
  .addCommand(skillSubcommand)
  .option(
    "-o, --output-dir <path>",
    "Directory to write MCP config files (default: cwd)"
  )
  .option("-f, --force", "Overwrite existing config without prompting")
  .option(
    "--cli <target...>",
    `CLI target(s): ${INIT_TARGETS.join(", ")} (repeat or comma-separate)`
  )
  .option(
    "-s, --scope <scope>",
    `Skill installation scope: ${INIT_SCOPES.join(", ")} (prompts if omitted)`,
    undefined
  )
  .option(
    "--claude-method <method...>",
    `Claude install method(s): ${CLAUDE_METHODS.join(", ")} (repeat or comma-separate)`,
    undefined
  )
  .action(
    async (
      options: {
        outputDir?: string;
        force?: boolean;
        cli?: string | string[];
        scope?: string;
        claudeMethod?: string | string[];
      },
      cmd: Command
    ) => {
      console.log(chalk.bold("\nConvoy Init\n"));

      let cliTargets;
      try {
        cliTargets = await resolveSkillTargets(parseCliTargets(options.cli));
      } catch (error) {
        handleInitError(error);
      }

      console.log(chalk.underline("Step 1: MCP Configuration\n"));
      const cwd = options.outputDir || process.cwd();
      const config = resolveConfigFromProfileCommand(cmd, cwd);

      if (config.convexUrl && config.apiKey && config.projectId) {
        try {
          await runInitMcp({
            convexUrl: config.convexUrl,
            apiKey: config.apiKey,
            projectId: config.projectId,
            outputDir: options.outputDir,
            force: options.force,
            cliTargets,
          });
        } catch (error) {
          if (error instanceof InitError) {
            console.error(chalk.red(`\n  ${error.message}`));
          } else {
            throw error;
          }
        }
      } else {
        console.log(chalk.yellow("  Skipping MCP setup (no profile configured)."));
        console.log(
          chalk.dim("  Run 'convoy setup' first, then 'convoy init mcp'.\n")
        );
      }

      console.log(chalk.underline("\nStep 2: CLI Skills\n"));

      try {
        const scope = parseScope(options.scope);
        const claudeMethods = cliTargets.includes("claude")
          ? parseClaudeMethods(options.claudeMethod)
          : undefined;

        await runInitSkill({
          cliTargets,
          scope,
          claudeMethods,
          force: options.force,
          baseDir: process.cwd(),
        });
      } catch (error) {
        handleInitError(error);
      }

      console.log(chalk.green("\n\u2713 Initialization complete.\n"));
    }
  );

export {
  InitError,
  runInitMcp,
  runInitSkill,
  getMarketplaceDir,
  parseCliTargets,
  parseScope,
  parseClaudeMethods,
  getClaudeSkillDestination,
  getCodexSkillDestination,
} from "./init/index.js";
