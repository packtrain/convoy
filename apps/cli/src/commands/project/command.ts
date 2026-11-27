import { targetEnvironment, targetCommands } from "../environment/index.js";
import { serviceRequest, serviceEndpoint } from "../service/client.js";
import { confirm } from "@inquirer/prompts";
import { Command, InvalidArgumentError, Option } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { addProject, checkProject, setProjectConcurrency, readProjectAccounts, listProjects, loginProject, openProjectShell, removeProject, type ProjectAddOptions } from "./workflow.js";
import { checkLines } from "./formatters.js";
import { loginRuntimeSchema, parseConcurrency, type LoginRuntime } from "./validators.js";

async function report(action: () => void | Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Project command failed.");
    process.exitCode = 1;
  }
}

export const projectCommand = new Command("project").description("Register projects for the background service");
addGlobalOptions(projectCommand.command("add <path>"))
  .option("--profile-key <key>", "Local profile key")
  .option("--create", "Create a remote project before registration")
  .option("--org <id-or-slug>", "Organization for the new project")
  .option("--project-name <name>", "New project name")
  .option("--project-alias <alias>", "New project alias (2-5 letters/numbers)")
  .option("--reuse", "Use an existing privately owned project directory")
  .option("--clone <url>", "Clone an HTTPS repository into a new directory")
  .option("--non-interactive", "Require complete inputs and never prompt")
  .addOption(new Option("--mode <mode>", "Environment mode on first Linux setup (default: shared)").choices(["shared", "isolated"]))
  .action((directory: string, _options: ProjectAddOptions, cmd: Command) => report(() => targetEnvironment() ? targetCommands.addProject(targetEnvironment()!, directory, cmd.optsWithGlobals()) : addProject(directory, cmd.optsWithGlobals())));
projectCommand.command("list").option("--json", "Print JSON")
  .action((options: { json?: boolean }) => report(async () => {
    if (!targetEnvironment()) return listProjects(Boolean(options.json));
    await targetCommands.listProjects(targetEnvironment()!, Boolean(options.json));
  }));
projectCommand.command("remove <profile>").option("--yes", "Confirm local unregistration").option("--interrupt", "Stop this project connection and active work before removal")
  .action((profile: string, options: { yes?: boolean; interrupt?: boolean }) => report(async () => {
    if (!targetEnvironment()) return removeProject(profile, Boolean(options.yes), Boolean(options.interrupt));
    if (!options.yes && (!process.stdin.isTTY || !await confirm({ message: `Unregister ${profile}? Files are retained.`, default: false }))) throw new Error("Removal cancelled. Use --yes for non-interactive removal.");
    await serviceRequest(serviceEndpoint(), { op: "project.remove", profile, interrupt: options.interrupt });
    console.log(`Unregistered ${profile}. Files retained.`);
  }));
const concurrency = (value: string) => {
  const parsed = value === "default" ? value : parseConcurrency(value);
  if (parsed === undefined) throw new InvalidArgumentError("Use a whole number from 1 to 50, or default.");
  return parsed;
};
projectCommand.command("set <profile>").description("Change a project's settings; a running connection applies them at its next reload")
  .requiredOption("--concurrency <n|default>", "Max simultaneous runs, 1-50; default clears the setting (5)", concurrency)
  .option("--interrupt", "Reload the project now, stopping its active runs")
  .action((profile: string, options: { concurrency: number | "default"; interrupt?: boolean }) => report(async () => {
    const value = options.concurrency === "default" ? null : options.concurrency;
    console.log(await setProjectConcurrency(profile, value, Boolean(options.interrupt), !targetEnvironment()));
  }));
const RUNTIMES = loginRuntimeSchema.options.join(", ");
const runtime = (value: string) => {
  const parsed = loginRuntimeSchema.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError(`Use one of: ${RUNTIMES}.`);
  return parsed.data;
};
projectCommand.command("shell <profile>").description("Open the project shell for runtime login and diagnostics: private when isolated, $SHELL in the folder when shared")
  .option("--expected-identity <identity>", "Require the confirmed project identity")
  .option("--login <runtime>", `Run only this runtime's login (${RUNTIMES}) instead of a shell`, runtime)
  .action((key: string, options: { expectedIdentity?: string; login?: LoginRuntime }) => report(async () => {
    if (targetEnvironment()) return targetCommands.shell(targetEnvironment()!, key, { expectedIdentity: options.expectedIdentity, login: options.login });
    await openProjectShell(key, options.expectedIdentity, undefined, options.login);
  }));
projectCommand.command("login <profile>").description("Run a runtime's login; an isolated project is paused first, then reloaded and awaited until online")
  .requiredOption("--runtime <runtime>", `Runtime to log in: ${RUNTIMES}`, runtime)
  .option("--interrupt", "Allow stopping the project's active runs")
  .action((key: string, options: { runtime: LoginRuntime; interrupt?: boolean }) => report(async () => {
    if (targetEnvironment()) return targetCommands.login(targetEnvironment()!, key, options.runtime, Boolean(options.interrupt));
    await loginProject(key, options.runtime, Boolean(options.interrupt));
  }));
// Guided setup for SSH remotes: the request arrives on stdin, so the API key never enters argv.
projectCommand.command("setup", { hidden: true }).action(async () => { await import("../environment/setup-entrypoint.js"); });
projectCommand.command("check <profile>").description("Check a project's runtimes, lease, backend key and, when isolated, its sandbox, without changing anything")
  .option("--json", "Print JSON; exits 0 whenever the check ran")
  .action((key: string, options: { json?: boolean }) => report(async () => {
    const result = targetEnvironment() ? await targetCommands.check(targetEnvironment()!, key) : await checkProject(key);
    if (options.json) { console.log(JSON.stringify(result)); return; }
    for (const line of checkLines(result)) console.log(line);
    if (result.checks.some(check => check.status === "fail")) process.exitCode = 1;
  }));

projectCommand.command("account <profile>").description("Read native runtime account status inside the project")
  .requiredOption("--expected-identity <identity>", "Require the displayed project identity")
  .action((profile: string, options: { expectedIdentity: string }) => report(async () => {
    console.log(JSON.stringify(targetEnvironment()
      ? await targetCommands.account(targetEnvironment()!, profile, options.expectedIdentity)
      : await readProjectAccounts(profile, options.expectedIdentity)));
  }));
