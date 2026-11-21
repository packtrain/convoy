import { targetEnvironment, targetCommands } from "../environment/index.js";
import { addServiceClients } from "./attach.js";
import { ServiceUnavailableError } from "./errors.js";
import { startupFailureSchema } from "./validators.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { isProjectEnvironment, SHARED_RUNTIME_ENV } from "../project/launcher.js";
import { serviceRequest, serviceEndpoint } from "./client.js";
import { ServiceLogs } from "./logs.js";
import { LAUNCH_AGENT_LABEL, launchAgentPath, removeLaunchAgent, servicePaths, writeLaunchAgent } from "./paths.js";
import { launchAgentPlist } from "./formatters.js";
import { chooseEnvironmentMode, recordEnvironmentMode } from "../environment/resolution.js";
import type { EnvironmentMode } from "../environment/validators.js";

async function report(action: () => Promise<void>) {
  try { await action(); } catch (error) {
    console.error(error instanceof Error ? error.message : "Service operation failed.");
    process.exitCode = 1;
  }
}

/** Shared mode keeps the starting PATH for its workers; isolated mode uses a fixed one. Spec: docs/specs/cli-shared-environments.md#execution */
export async function startService(background: boolean, quiet = false): Promise<void> {
  if (process.platform === "win32") throw new Error("The project service runs on macOS and Linux. Windows is unsupported.");
  if (!process.getuid?.()) throw new Error("Run convoy service start as your own account, not root.");
  const mode = recordEnvironmentMode();
  if (mode === "isolated" && !isProjectEnvironment()) {
    throw new Error("This environment is isolated, but the project launcher registry /etc/convoy-projects.json is missing. Reinstall the launcher; isolated projects never run unsandboxed.");
  }
  servicePaths();
  if (process.platform === "darwin") {
    try { writeLaunchAgent(launchAgent(), true); } catch { /* a stale login job never blocks a start */ }
  }
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const entrypoint = fileURLToPath(new URL(`./service-entrypoint.${extension}`, import.meta.url));
  const child = spawn(process.execPath, [...process.execArgv, entrypoint], {
    cwd: "/", detached: background, stdio: ["ignore", "pipe", "pipe"],
    env: { HOME: process.env.HOME, PATH: mode === "shared" ? process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" : "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8",
      ...mode === "shared" ? Object.fromEntries(SHARED_RUNTIME_ENV.flatMap(name => process.env[name] ? [[name, process.env[name]]] : [])) : {} },
  });
  let exited = false;
  let detached = false;
  const exit = new Promise<number>((resolve) => { child.once("exit", (code) => { exited = true; resolve(code ?? 1); }); });
  let stopRequested = false;
  const stop = () => { stopRequested = true; child.kill("SIGTERM"); };
  if (!background) {
    process.once("SIGINT", stop); process.once("SIGTERM", stop); process.once("SIGHUP", stop);
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Service startup timed out. Check project list and launcher setup.")); }, 15000);
      let output = "";
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once("error", () => fail(new Error("Cannot start service. Check the CLI installation.")));
      child.once("exit", () => fail(new Error("Service startup failed. Check project list, config.toml, launcher setup and private HOME permissions.")));
      child.stderr.resume();
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output === "ready\n") { clearTimeout(timer); resolve(); }
        else if (Buffer.byteLength(output) > 1024) fail(new Error("Invalid service readiness response."));
        else if (output.includes("\n")) {
          try { fail(new Error(startupFailureSchema.parse(JSON.parse(output)).error)); }
          catch { fail(new Error("Invalid service readiness response.")); }
        }
      });
    });
    if (!quiet) console.log("Service ready. Use convoy service status and convoy service logs --follow.");
    if (background) {
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      detached = true;
    } else {
      const code = await exit;
      if (code !== 0 && !stopRequested) throw new Error("Service exited unexpectedly. Inspect convoy service logs.");
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); process.removeListener("SIGHUP", stop);
    if (!detached && !exited) child.kill("SIGTERM");
  }
}

/** The login job runs this CLI with the caller's PATH, since launchd starts with a minimal one. */
function launchAgent(): string {
  const environment = Object.fromEntries(["PATH", ...SHARED_RUNTIME_ENV].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));
  return launchAgentPlist(LAUNCH_AGENT_LABEL, [process.execPath, ...process.execArgv, process.argv[1], "service", "start"], environment);
}

function requireLaunchd(): void {
  if (targetEnvironment()) throw new Error("A managed Docker environment restarts with Docker. Rebuild one created before CLI 0.141.0.");
  if (process.platform !== "darwin") throw new Error("Starting at login is macOS only. On Linux, start convoy service start -b from your init system.");
}

function configureStart(command: Command): Command {
  return command
    .option("-b, --background", "Persist after this terminal closes")
    .addOption(modeOption())
    .action((options: { background?: boolean; mode?: EnvironmentMode }) => report(async () => {
      const target = targetEnvironment();
      if (target) { await targetCommands.start(target); return; }
      await chooseEnvironmentMode(options.mode, Boolean(process.stdin.isTTY));
      await startService(Boolean(options.background));
    }));
}
const modeOption = () => new Option("--mode <mode>", "Environment mode on first Linux setup (default: shared)").choices(["shared", "isolated"]);

export const serviceCommand = new Command("service").description("Start or manage the local project service");
configureStart(serviceCommand.command("start")
  .description("Run registered projects in the background"));
// `remote add` runs this over ssh -t. Spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets
serviceCommand.command("mode").description("Print this environment's mode; on first Linux setup, choose it")
  .addOption(modeOption())
  .action((options: { mode?: EnvironmentMode }) => report(async () => {
    if (targetEnvironment()) throw new Error("A managed Docker environment's mode is set when it is created.");
    console.log(`Mode: ${await chooseEnvironmentMode(options.mode, Boolean(process.stdin.isTTY))}`);
  }));
serviceCommand.command("status").option("--json", "Print structured status")
  .action((options: { json?: boolean }) => report(async () => {
    const response = await serviceRequest(serviceEndpoint(), { op: "status" });
    if (options.json) console.log(JSON.stringify(response));
    else {
      console.log(`Service ${response.pid}${response.stopping ? " stopping" : " running"}. Registration changes are reconciled.`);
      if (response.configurationError) console.log("Invalid configuration; last valid connections retained. Repair config then run convoy service reload.");
      if (response.profiles?.length) console.table(response.profiles);
      else console.log("No registered projects.");
    }
  }));
serviceCommand.command("pause <profile>").description("Release one project for private runtime setup")
  .option("--interrupt", "Allow stopping the selected connection and active work")
  .action((profile: string, options: { interrupt?: boolean }) => report(async () => {
    await serviceRequest(serviceEndpoint(), { op: "reconcile", profile, interrupt: options.interrupt, pause: true });
    console.log(`Paused ${profile}. Exit its project shell before running convoy service reload --profile ${profile} --interrupt. Service restart also resumes it.`);
  }));
serviceCommand.command("reload").description("Reconcile registrations after configuration changes")
  .option("--profile <key>", "Select a changed project connection")
  .option("--interrupt", "Stop the selected connection to apply its pending change")
  .action((options: { profile?: string; interrupt?: boolean }) => report(async () => {
  const response = await serviceRequest(serviceEndpoint(), { op: "reconcile", profile: options.profile, interrupt: options.interrupt });
  console.log(response.applied ? "Registrations applied." : "Live connections have pending changes. Use convoy service reload --profile <key> --interrupt to apply a pending change.");
}));
serviceCommand.command("stop").action(() => report(async () => {
  if (targetEnvironment()) { await targetCommands.lifecycle(targetEnvironment()!, "stop"); return; }
  await serviceRequest(serviceEndpoint(), { op: "stop" });
  console.log("Service stopped. Project data retained.");
}));
serviceCommand.command("enable").description("Start the service at each macOS login")
  .action(() => report(async () => {
    requireLaunchd();
    writeLaunchAgent(launchAgent());
    console.log(`The service starts at each login (${launchAgentPath()}). It is not started now; run convoy service start -b.`);
  }));
serviceCommand.command("disable").description("Stop starting the service at login")
  .action(() => report(async () => {
    requireLaunchd();
    console.log(removeLaunchAgent() ? "The service no longer starts at login. A running service keeps running." : "The service was not set to start at login.");
  }));
serviceCommand.command("logs").option("--follow", "Follow operational events; Ctrl+C detaches")
  .option("--profile <key>", "Filter by profile").option("--json", "Print NDJSON")
  .action((options: { follow?: boolean; profile?: string; json?: boolean }) => report(async () => {
    const target = targetEnvironment();
    if (target && !options.follow) {
      for (const entry of await targetCommands.operationalLogs(target, options.profile)) {
        console.log(options.json ? JSON.stringify(entry) : `${new Date(entry.ts).toISOString()} [${entry.profile}] ${entry.message}`);
      }
      return;
    }
    const paths = target ? undefined : servicePaths(undefined, false);
    let cursor = 0;
    let following = true;
    const stop = () => { following = false; };
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(name, stop);
    try {
      do {
        const response = await serviceRequest(serviceEndpoint(), { op: "logs", after: cursor, profile: options.profile })
          .catch((error) => {
            if (!paths || options.follow || !(error instanceof ServiceUnavailableError)) throw error;
            return new ServiceLogs(paths.directory, undefined, "reader").read(cursor, options.profile);
          });
        if (response.gap) console.error("Some operational logs have expired from retention.");
        for (const entry of response.entries ?? []) {
          console.log(options.json ? JSON.stringify(entry) : `${new Date(entry.ts).toISOString()} [${entry.profile}] ${entry.message}`);
        }
        const previous = cursor;
        cursor = response.cursor ?? cursor;
        if (!options.follow && cursor === previous) break;
        if (options.follow) await new Promise((resolve) => setTimeout(resolve, 500));
      } while (following);
    } finally {
      for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(name, stop);
    }
  }));

addServiceClients(serviceCommand);
