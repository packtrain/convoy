import { getCliVersion } from "../../lib/version.js";
import { spawn } from "node:child_process";
import { Command, Option } from "commander";
import { attachCommand } from "../service/attach.js";
import { configureServiceTransport, ServiceClient } from "../service/client.js";
import { bridge } from "./docker.js";
import { environmentDirectory, readEnvironment, saveEnvironment, withEnvironmentLock } from "./paths.js";
import { EnvironmentController, loadEnvironment, runEnvironment } from "./workflow.js";
import { setTargetEnvironment } from "./resolution.js";
import { containerName, type Environment } from "./validators.js";
import type { LoginRuntime } from "../project/validators.js";

async function report(action: () => Promise<void>) {
  try { await action(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Environment command failed."); process.exitCode = 1; }
}

export async function targetLifecycle(environment: Environment, operation: "stop" | "restart") {
  const directory = environmentDirectory(environment.name);
  return withEnvironmentLock(directory, () => new EnvironmentController().operation(environment, operation === "stop" ? "service-stop" : operation, { interrupt: true }));
}

export async function targetShell(environment: Environment, profile: string, command?: string, options: { expectedIdentity?: string; signal?: AbortSignal; login?: LoginRuntime; cli?: string[] } = {}) {
  options.signal?.throwIfAborted();
  const cli = options.cli ?? ["project", "shell", profile, ...(options.expectedIdentity ? ["--expected-identity", options.expectedIdentity] : []),
    ...(options.login ? ["--login", options.login] : [])];
  const child = spawn("docker", ["exec", "-i", ...(process.stdin.isTTY && !command ? ["-t"] : []), "--user", "node",
    containerName(environment), "convoy", ...cli], { stdio: command ? ["pipe", "inherit", "inherit"] : "inherit" });
  if (command) { child.stdin!.on("error", () => {}); child.stdin!.end(command + "\n"); }
  const stop = () => child.kill("SIGTERM");
  options.signal?.addEventListener("abort", stop, { once: true });
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    options.signal?.throwIfAborted();
    if (code !== 0) throw new Error(`${options.login ? "Runtime login" : "Project shell"} exited with status ${code ?? "unknown"}.`);
  } finally { options.signal?.removeEventListener("abort", stop); for (const signal of ["SIGTERM", "SIGHUP"] as const) process.off(signal, stop); }
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function registerEnvironmentCommands(program: Command) {
  program.addCommand(new Command("run").description("Provision a local environment, start its service and attach")
    .option("--env, --environment <name>", "Managed environment name", "default")
    .option("--deployment <name>", "Convex deployment to allow through the firewall")
    .option("--domains <domains>", "Additional comma-separated HTTPS domains")
    .addOption(new Option("--mode <mode>", "Project separation for a new environment (default: shared)").choices(["shared", "isolated"]))
    .option("--mount <folder>", "Host folder to mount at the same path, shared mode only; repeatable", collect)
    .option("--package <tgz>", "Build with a local CLI package for acceptance testing")
    .option("--no-attach", "Return after service readiness")
    .option("--json", "Use NDJSON for attachment")
    .action(options => report(async () => {
      const environment = await runEnvironment(options.environment, { deployment: options.deployment, domains: options.domains, mode: options.mode, mounts: options.mount, localPackage: options.package });
      console.error(`Environment ${environment.name} ready. Use project add --target ${environment.name}.`);
      if (options.attach) {
        configureServiceTransport(() => bridge(environment));
        await attachCommand.parseAsync([...(options.json ? ["--json"] : [])], { from: "user" });
      } else console.log(JSON.stringify(await new EnvironmentController().operation(environment, "status")));
    })));
  const command = program.command("environment").alias("env").description("Manage a Convoy-owned local Docker environment");
  for (const operation of ["status", "stop", "restart", "update", "rebuild"] as const) {
    const sub = command.command(operation).requiredOption("--env, --environment <name>", "Managed environment name").option("--json", "Print JSON");
    if (["restart", "update", "rebuild"].includes(operation)) sub.option("--interrupt", "Allow stopping connections and active agent work");
    if (operation === "update") sub.option("--version <version>", "Exact published CLI version").option("--package <tgz>", "Update from a local CLI package instead of npm");
    if (operation === "rebuild") sub.option("--package <tgz>", "Build with a local package")
      .option("--mount <folder>", "Replace the mounted host folders; repeatable", collect).option("--no-mounts", "Remove every mounted host folder");
    sub.action(options => report(async () => {
      if (options.mount && options.mounts === false) throw new Error("Use --mount or --no-mounts, not both.");
      const directory = environmentDirectory(options.environment);
      await withEnvironmentLock(directory, async () => {
        const environment = readEnvironment(directory);
        if (!environment) throw new Error("Unknown environment. Run convoy run first.");
        // Saved on failure too: a half-done rebuild leaves the record describing the container that exists.
        let result: Record<string, unknown>;
        try { result = await new EnvironmentController().operation(environment, operation, { ...options, localPackage: options.package, mounts: options.mounts === false ? [] : options.mount }); }
        finally { saveEnvironment(directory, environment); }
        console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
      });
    }));
  }
  for (const root of program.commands.filter(c => ["attach", "service", "project", "keys"].includes(c.name()))) {
    const visit = (c: Command) => { c.option("--env, --environment <name>", "Target a managed local Docker environment"); c.commands.forEach(visit); };
    visit(root);
  }
  program.hook("preAction", async (_root, action) => {
    const options = action.optsWithGlobals();
    let root = action;
    while (root.parent && root.parent !== program) root = root.parent;
    if (!options.environment || !["attach", "service", "project", "keys"].includes(root.name())) return;
    if (action.name() === "bridge") throw new Error("The internal bridge runs inside the execution environment.");
    const environment = await loadEnvironment(options.environment);
    const retainedLogs = root.name() === "service" && action.parent === root && action.name() === "logs" && !options.follow;
    if (!["start", "stop"].includes(action.name()) && !retainedLogs) {
      const client = await ServiceClient.open(bridge(environment));
      try {
        if (!client.hello?.capabilities?.includes("host-cli-v1")) throw new Error("Target CLI lacks host management support. Update it with convoy environment update --environment " + environment.name + " --version " + getCliVersion() + " --interrupt.");
        console.error(`Environment ${environment.name}: host ${getCliVersion()}, service ${client.hello.version ?? "unknown"}.`);
      } finally { client.close(); }
    }
    setTargetEnvironment(environment);
    configureServiceTransport(() => bridge(environment));
  });
}
