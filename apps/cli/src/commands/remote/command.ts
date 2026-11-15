import { Command, Option } from "commander";
import { compareVersions } from "../../agent/sdk/versioning/provider-version.js";
import type { EnvironmentMode } from "../environment/validators.js";
import { configureServiceTransport } from "../service/client.js";
import { readRemote, readRemotes, saveRemotes } from "./paths.js";
import { remoteVersion, sshBridge, sshForward } from "./ssh.js";
import { remoteSchema } from "./validators.js";
import { setTargetRemote, targetOption } from "./resolution.js";
import { environmentExists } from "../environment/paths.js";

const ROOTS = ["attach", "service", "project", "keys"];
// Run on the host over the bridge; everything else under ROOTS runs on the remote CLI.
// Keep in sync with the protocol clients in service/command.ts and addServiceClients.
const PROTOCOL = ["attach", "service status", "service pause", "service reload", "service stop", "service outcome", "service runs"];

async function report(action: () => Promise<void>) {
  try { await action(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Remote command failed."); process.exitCode = 1; }
}

function commandPath(command: Command) {
  const names: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent) names.unshift(current.name());
  return names;
}

/** Rebuild the explicitly given arguments, minus the target, for the remote CLI. */
export function forwardedArgs(action: Command) {
  const given = (command: Command) => command.options.flatMap(option => {
    const key = option.attributeName();
    if (key === "remote" || key === "target" || command.getOptionValueSource(key) !== "cli") return [];
    const value: unknown = command.getOptionValue(key);
    return typeof value === "boolean" ? [option.long!] : [value].flat().flatMap(item => [option.long!, String(item)]);
  });
  const options: string[] = [];
  let current = action;
  for (; current.parent; current = current.parent) options.unshift(...given(current));
  // Root options must precede the command path for the remote parser.
  return [...given(current), ...commandPath(action), ...options, "--", ...action.args];
}

export function registerRemoteCommands(program: Command) {
  const command = program.command("remote").description("Manage saved SSH targets running a Convoy service");
  command.command("add <name>").description("Save an SSH target after checking its Convoy installation")
    .requiredOption("--host <destination>", "SSH destination or ~/.ssh/config host alias")
    .option("--container <name>", "Run Convoy inside this existing container on the remote host")
    .option("--command <path>", "Absolute path of the remote convoy executable")
    .addOption(new Option("--mode <mode>", "Environment mode on a fresh Linux target (default: shared)").choices(["shared", "isolated"]))
    .action((name: string, { mode, ...options }: { host: string; container?: string; command?: string; mode?: EnvironmentMode }) => report(async () => {
      const remote = remoteSchema.parse({ name, ...options });
      const exists = () => {
        if (readRemotes().some(value => value.name === name)) throw new Error(`Remote ${name} already exists. Remove it first.`);
        if (environmentExists(name)) throw new Error(`Environment ${name} already uses this name, so --target ${name} would be ambiguous. Choose another name.`);
      };
      exists();
      const { version, command } = await remoteVersion(remote);
      exists(); // Reread: another command may have saved during the SSH check.
      const saved = command ? { ...remote, command } : remote;
      saveRemotes([...readRemotes(), saved]);
      console.log(`Saved remote ${name}: Convoy ${version} on ${remote.host}${remote.container ? ` in ${remote.container}` : ""}${command ? ` at ${command}` : ""}. Use --target ${name}.`);
      // The remote CLI asks only while its mode is open; sudo prompts over ssh -t. Spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets
      if (!mode && !(process.stdin.isTTY && process.stdout.isTTY)) return;
      if (compareVersions(version, "0.140.0") < 0) {
        if (mode) throw new Error(`Remote ${name} is saved, but Convoy ${version} there predates --mode, so its mode was not set. Update it to 0.140.0 or later, then run convoy service mode --mode ${mode} --remote ${name}.`);
        console.log(`Convoy ${version} on ${name} cannot choose its mode from here. Update it to 0.140.0 or later to choose.`);
        return;
      }
      if (await sshForward(saved, ["service", "mode", ...(mode ? ["--mode", mode] : [])])) throw new Error(`Remote ${name} is saved, but its mode was not set. Retry with convoy service mode --remote ${name}.`);
    }));
  command.command("list").option("--json", "Print JSON").action((options: { json?: boolean }) => report(async () => {
    const remotes = readRemotes();
    if (options.json) console.log(JSON.stringify(remotes));
    else if (remotes.length) console.table(remotes);
    else console.log("No remotes. Add one with convoy remote add <name> --host <ssh-destination>.");
  }));
  command.command("remove <name>").description("Forget a saved target; the remote is unchanged")
    .action((name: string) => report(async () => {
      readRemote(name);
      saveRemotes(readRemotes().filter(value => value.name !== name));
      console.log(`Removed remote ${name}. Nothing on the remote host was changed.`);
    }));

  for (const root of program.commands.filter(c => ROOTS.includes(c.name()))) {
    const visit = (c: Command) => {
      c.option("--target <name>", "Target a managed environment or saved SSH remote by name").option("--remote <name>", "Target a saved SSH remote");
      c.commands.forEach(visit);
    };
    visit(root);
  }
  program.hook("preAction", async (_root, action) => {
    let options = action.optsWithGlobals();
    const path = commandPath(action);
    if (options.target && ROOTS.includes(path[0])) {
      if (options.remote || options.environment) throw new Error("Use one of --target, --remote or --environment.");
      // The Docker hook registered after this one reads the same option.
      action.setOptionValue(targetOption(options.target), options.target);
      options = action.optsWithGlobals();
    }
    if (!options.remote || !ROOTS.includes(path[0])) return;
    if (options.environment) throw new Error("Use either --remote or --environment, not both.");
    if (path.join(" ") === "service bridge") throw new Error("The internal bridge runs inside the execution environment.");
    const remote = readRemote(options.remote);
    // Keys run here: secret input stays on this host and mutations use the bridge. Spec: docs/specs/cli-remote.md#managed-credentials-cli-01190-os-2020
    if (path[0] === "keys") {
      console.error(`Remote ${remote.name}: ${remote.host}${remote.container ? ` in ${remote.container}` : ""}.`);
      setTargetRemote(remote);
      configureServiceTransport(() => sshBridge(remote));
      return;
    }
    if (!PROTOCOL.some(prefix => prefix.split(" ").every((name, index) => path[index] === name))) process.exit(await sshForward(remote, forwardedArgs(action)));
    configureServiceTransport(() => sshBridge(remote));
  });
}
