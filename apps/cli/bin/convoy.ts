#!/usr/bin/env node
import * as path from "node:path";
import { program } from "commander";
import { getCliVersion } from "../src/lib/version.js";
import { registerCommands } from "../src/cli.js";
import { resolveProfile, resolveConfigFromProfile, getAllProfiles, addPathToProfile } from "../src/lib/config/index.js";
import { runSetup } from "../src/commands/setup/workflow.js";
import {
  connectUsingProfile,
  resolveCodexAppServer,
  resolveConnectConcurrency,
  resolveIsolated,
  resolvePartialStreaming,
} from "../src/commands/connect/workflow.js";
import { promptUnmatchedFolder } from "../src/commands/setup/prompts.js";
import { canPromptToConnect } from "../src/commands/connect/prompts.js";
import { emitConnectEvent, exitAfterFlush } from "../src/lib/connect-events.js";
import { normalizeCommandArgv } from "../src/lib/argv.js";
import chalk from "chalk";
import { isProjectEnvironment } from "../src/commands/project/launcher.js";

// EPIPE guard: a downstream reader (`| head`, `| jq`) may close the pipe while we
// are still writing, which would otherwise surface as an unhandled Node stack.
process.stdout.on("error", () => {});

program
  .name("convoy")
  .description("CLI agent for Convoy - connect your repo to the web app")
  .version(getCliVersion())
  .enablePositionalOptions()
  .option("--url <url>", "Convex backend URL (overrides config)")
  .option("--api-key <key>", "API key (overrides config)")
  .option("--profile <name>", "Profile key (for profile lookup)")
  .option("--project <id>", "Project ID (overrides config)")
  .option(
    "--buffered",
    "Send whole agent events only, instead of streaming partial (delta) events for live token streaming in the web UI"
  )
  .option(
    "--isolated",
    "Run agents in an OS-level sandbox restricted to the profile's paths (Claude Code and Codex only)"
  )
  .option(
    "--codex-exec",
    "Run Codex through non-interactive `codex exec --json` instead of the app-server transport (no mid-run approvals, plan mode, steering, or context-window meter)"
  );

registerCommands(program);

// Default action: check config and either setup or connect
program.action(async (options) => {
  // Bare convoy prompts; with nobody to answer, show help instead (OS-2266).
  if (!canPromptToConnect()) {
    program.outputHelp({ error: true });
    console.error("\nRun 'convoy connect' to start a connection.");
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();

  // Try to resolve profile using new config system
  const resolution = resolveProfile(cwd, {
    profile: options.profile,
    url: options.url,
    apiKey: options.apiKey,
    projectId: options.project,
  });

  if (isProjectEnvironment() && !resolution.profile?.project_isolation) {
    console.error("Use convoy project add to register a project, then connect --profile <key>.");
    process.exitCode = 1;
    return;
  }

  // If no profile found, prompt user to create or select one
  if (resolution.source === "none" || !resolution.profile) {
    const profiles = getAllProfiles();

    if (profiles.length === 0) {
      // No profiles exist at all - run setup
      await runSetup({
        url: options.url,
        apiKey: options.apiKey,
        profile: options.profile,
        project: options.project,
      });
      return;
    }

    // Profiles exist but none match - three-way prompt
    const choice = await promptUnmatchedFolder(profiles);

    if (choice.action === "create") {
      await runSetup({
        url: options.url,
        apiKey: options.apiKey,
        profile: options.profile,
        project: options.project,
      });
      return;
    }

    const selectedProfile = profiles.find((p) => p.key === choice.key);
    if (!selectedProfile) {
      console.error(chalk.red("Selected profile not found"));
      process.exit(1);
    }

    let paths = selectedProfile.profile.paths;

    if (choice.action === "add-folder") {
      addPathToProfile(choice.key, cwd);
      // Include the newly added path (in-memory copy is stale after disk write)
      const resolved = path.resolve(cwd);
      if (!paths.some((p) => path.resolve(p) === resolved)) {
        paths = [...paths, resolved];
      }
      console.log(chalk.green("✓") + ` Added folder to profile "${choice.key}"`);
    }

    await connectUsingProfile({
      profileKey: choice.key,
      profileName: selectedProfile.profile.name,
      convexUrl: selectedProfile.profile.url,
      apiKey: selectedProfile.profile.api_key,
      projectId: selectedProfile.profile.project_id,
      paths,
      concurrency: resolveConnectConcurrency(
        undefined,
        selectedProfile.profile.concurrency
      ),
      partialStreaming: resolvePartialStreaming(
        options.buffered,
        selectedProfile.profile.streaming
      ),
      isolated: resolveIsolated(options.isolated, selectedProfile.profile.isolated),
      codexAppServer: resolveCodexAppServer(options.codexExec),
    });
    return;
  }

  // Profile found - get resolved config with overrides applied
  const config = resolveConfigFromProfile(cwd, {
    url: options.url,
    apiKey: options.apiKey,
    profile: options.profile,
    projectId: options.project,
  });

  // If all config is present, connect directly
  if (config.convexUrl && config.apiKey && config.projectId) {
    if (!resolution.key) {
      console.error(chalk.red("\nResolved profile key is missing."));
      process.exit(1);
    }

    await connectUsingProfile({
      profileKey: resolution.key,
      profileName: resolution.profile.name,
      convexUrl: config.convexUrl,
      apiKey: config.apiKey,
      projectId: config.projectId,
      paths: resolution.profile.paths,
      resolutionSource: resolution.source,
      concurrency: resolveConnectConcurrency(
        undefined,
        resolution.profile.concurrency
      ),
      partialStreaming: resolvePartialStreaming(
        options.buffered,
        resolution.profile.streaming
      ),
      isolated: resolveIsolated(options.isolated, resolution.profile.isolated),
      codexAppServer: resolveCodexAppServer(options.codexExec),
    });
  } else {
    // Missing some config - run setup
    await runSetup({
      url: options.url,
      apiKey: options.apiKey,
      profile: options.profile,
      project: options.project,
    });
  }
});

await program.parseAsync(normalizeCommandArgv(process.argv)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Command failed.";
  console.error(chalk.red(message));
  emitConnectEvent({ event: "status", status: "failed", message });
  exitAfterFlush(1);
});
