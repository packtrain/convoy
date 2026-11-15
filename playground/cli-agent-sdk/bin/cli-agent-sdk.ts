#!/usr/bin/env node
import { program } from "commander";
import { runChat } from "../src/cli.js";

// Some package managers forward a literal `--` through to the script.
// Commander treats args after `--` as positional args; since this CLI defines none,
// that shows up as "too many arguments". Strip a standalone `--` defensively.
const argv = process.argv.slice();
const doubleDashIndex = argv.indexOf("--");
if (doubleDashIndex !== -1) argv.splice(doubleDashIndex, 1);

program
  .name("cli-agent-sdk")
  .description("CLI for exploring agent SDKs (Claude, Codex)")
  .version("0.1.0")
  .option(
    "--agent <agent>",
    "Agent: claude-agent-sdk | claude-cli-json | codex-cli-json | generic-cli | mock-cli-json | mock-cli-line",
    "claude-cli-json"
  )
  .option("-p, --prompt <prompt>", "Initial prompt (non-interactive mode)")
  .option("--once", "Ask for a single prompt then exit", false)
  .option("--cwd <path>", "Working directory for the agent")
  .option("--raw-json", "Print raw provider payloads", false)
  .option(
    "--permission-mode <mode>",
    "Claude SDK permission mode: bypassPermissions | plan | default | acceptEdits | dontAsk | auto",
    "bypassPermissions"
  )
  .option("--model <model>", "Claude SDK model override")
  .option("--claude-executable <path>", "Claude Code executable path for the SDK")
  .action(runChat);

program.parse(argv);
