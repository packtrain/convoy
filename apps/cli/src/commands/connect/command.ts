import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import {
  DEFAULT_CONNECT_CONCURRENCY,
  parseConnectConcurrencyOption,
  runConnectCommandAction,
} from "./workflow.js";

interface ConnectOptions {
  force?: boolean;
  repo?: string;
  name?: string;
  stream?: string;
  delay?: string;
  concurrency?: string;
  streaming?: boolean;
  isolated?: boolean;
  codexAppServer?: boolean;
  json?: boolean;
  providerKey?: string;
}

export const connectCommand = addGlobalOptions(
  new Command("connect")
    .description("Start agent connection (long-running)")
    .option("--repo <path>", "Path to repository (defaults to current directory)")
    .option("--force", "Disconnect existing backend sessions and take over this profile")
    .option("--name <name>", "Connection name (defaults to folder name)")
    .option("-s, --stream <path>", "Stream from a JSONL file instead of running a real agent")
    .option("-d, --delay <ms>", "Delay between streamed lines in ms (default: 1500)")
    .option(
      "-c, --concurrency <n>",
      `Max simultaneous chat subprocesses (profile setting or default: ${DEFAULT_CONNECT_CONCURRENCY})`
    )
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
    )
    .option(
      "--provider-key <name>",
      "Use this [keys.<name>] provider key for this run, overriding the profile's assigned key (not persisted)"
    )
    .option(
      "--json",
      "Emit machine-readable NDJSON status events on stdout for supervisors; human logs move to stderr"
    )
).action(async (options: ConnectOptions, cmd: Command) => {
  await runConnectCommandAction(options, cmd);
});

export { DEFAULT_CONNECT_CONCURRENCY, parseConnectConcurrencyOption };
