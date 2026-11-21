import { Command } from "commander";
import chalk from "chalk";
import { input, password, select } from "@inquirer/prompts";
import {
  PROVIDER_LABELS,
  deleteProviderKey,
  getProviderKey,
  listAllProfiles,
  listProviderKeys,
  providerRequiresToken,
  resolveProfile,
  setProfileProviderKey,
  setProviderKey,
  type ProviderKey,
} from "../../lib/config/index.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { awsRegionSchema, keyRuntimeSchema, type Binding, type CredentialMutation } from "../../lib/config/credentials/validators.js";
import { changeCredentials, inputSecret, managedProfile, managedStatus, printManagedStatus, runManagedCommand, targeted } from "./workflow.js";
import { addGlobalOptions } from "../../cli.js";

const PROVIDERS = ["bedrock", "mantle", "anthropic"] as const;
const RUNTIMES = keyRuntimeSchema.options.join(", ");
/** Runtimes with a legacy config.toml assignment on ordinary profiles. */
const TOML_RUNTIMES: unknown[] = ["codex", "claude-code"];

function isProvider(value: unknown): value is ProviderKey["provider"] {
  return PROVIDERS.includes(value as ProviderKey["provider"]);
}

function maskToken(token: string): string {
  if (token.length <= 10) {
    return "***";
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/** Profile key when a `--runtime` assignment lives in TOML: ordinary profiles; isolated and shared registrations use the managed store. */
function ordinaryRuntimeProfile(cmd: Command): string | undefined {
  const runtime = cmd.opts().runtime;
  if (runtime !== undefined && !keyRuntimeSchema.safeParse(runtime).success) {
    console.error(chalk.red(`\nUnknown runtime "${runtime}". Use one of: ${RUNTIMES}.`));
    process.exit(1);
  }
  if (targeted()) {
    if (runtime === undefined) throw new Error(`Target key assignment requires --runtime (${RUNTIMES}) and an explicit --profile.`);
    return undefined;
  }
  if (!TOML_RUNTIMES.includes(runtime)) return undefined;
  const resolution = resolveProfile(process.cwd(), { profile: cmd.optsWithGlobals().profile });
  return resolution.profile?.project_isolation || resolution.profile?.project_mode ? undefined : resolveProfileKeyOrExit(cmd, resolution);
}

/** The managed bind request; Codex omits `runtime`, as older services expect. */
function managedBind(cmd: Command, binding: Binding): CredentialMutation {
  const runtime = keyRuntimeSchema.safeParse(cmd.opts().runtime).data;
  if (!runtime) throw new Error(`Use --runtime with one of ${RUNTIMES} for managed keys.`);
  return {
    action: "bind",
    profile: managedProfile(cmd.optsWithGlobals().profile),
    ...(runtime !== "codex" ? { runtime } : {}),
    binding,
  };
}

function resolveProfileKeyOrExit(
  cmd: Command,
  resolution = resolveProfile(process.cwd(), { profile: cmd.optsWithGlobals().profile })
): string {
  if (!resolution.key) {
    console.error(chalk.red("\nNo profile resolved for this directory."));
    console.log(chalk.dim("Pass --profile <key> or run from a profile folder."));
    process.exit(1);
  }
  return resolution.key;
}

/**
 * Build the `[keys.<name>]` entry for a provider, prompting for the token when
 * one is needed. `anthropic` carries no credential — it pins agents to this
 * machine's Claude sign-in — so token/region are rejected instead of stored
 * where nothing would ever read them.
 */
async function buildEntry(provider: ProviderKey["provider"], options: { token?: string; region?: string }): Promise<ProviderKey> {
  if (!providerRequiresToken(provider)) {
    if (options.token || options.region) {
      console.error(chalk.red(`\nProvider "${provider}" takes no --token or --region — it uses this machine's Claude sign-in.`));
      process.exit(1);
    }
    return { provider };
  }

  const prompted = options.token === undefined;
  const token = options.token ?? (await password({ message: "API key / token", mask: "*" }));
  if (!token.trim()) {
    console.error(chalk.red("\nToken cannot be empty."));
    process.exit(1);
  }
  const region = options.region ?? (prompted
    ? (await input({ message: "AWS region (optional for Claude Code, required for Codex)" })).trim()
    : undefined);

  return {
    provider,
    token: token.trim(),
    ...(region ? { region } : {}),
  };
}

const addCommand = new Command("add")
  .description("Store a local model-provider credential or native login choice")
  .argument("<name>", "Entry name (e.g. work-bedrock, claude-sub)")
  .option("--provider <provider>", `Provider: ${PROVIDERS.join(", ")}, openai, cursor, gemini`)
  .option("--auth <mode>", "Managed authentication mode: api-key (openai for isolated Codex, anthropic for isolated Claude Code, mantle/bedrock for both, cursor for isolated Cursor, gemini for isolated Antigravity; openai, anthropic and bedrock also serve isolated OpenCode)")
  .option("--from-env <name>", "Import managed key from an environment variable")
  .option("--stdin", "Read managed key from stdin")
  .option("--token <token>", "API key / bearer token (prompted if omitted; not used by anthropic)")
  .option("--region <region>", "AWS region (e.g. us-east-1; required for Codex, not used by anthropic)")
  .action(
    async (
      name: string,
      options: { provider?: string; token?: string; region?: string; auth?: string; fromEnv?: string; stdin?: boolean }
    ) => {
      let provider = options.provider;
      const aws = provider === "mantle" || provider === "bedrock" ? provider : undefined;
      // Plain `--provider anthropic` stays the credential-free native-login entry.
      const anthropic = provider === "anthropic" && options.auth !== undefined;
      if (provider === "openai" || provider === "cursor" || provider === "gemini" || anthropic || (aws && options.auth)) {
        await runManagedCommand(async () => {
          if (options.auth !== "api-key") throw new Error("Use --auth api-key for managed entries.");
          const input = { fromEnv: options.fromEnv, stdin: options.stdin, token: options.token };
          if (provider === "cursor") {
            if (options.region) throw new Error("Managed Cursor keys take no --region.");
            const secret = await inputSecret(input, "Cursor API key (billed to its Cursor account)");
            return changeCredentials({ action: "add", name, secret, provider: "cursor" });
          }
          if (provider === "gemini") {
            if (options.region) throw new Error("Managed Gemini keys take no --region.");
            const secret = await inputSecret(input, "Gemini API key (API usage billing)");
            return changeCredentials({ action: "add", name, secret, provider: "gemini" });
          }
          if (anthropic) {
            if (options.region) throw new Error("Managed Anthropic keys take no --region.");
            const secret = await inputSecret(input, "Anthropic API key (API usage billing)");
            return changeCredentials({ action: "add", name, secret, provider: "anthropic" });
          }
          if (!aws) {
            if (options.region) throw new Error("Managed OpenAI keys take no --region.");
            return changeCredentials({ action: "add", name, secret: await inputSecret(input) });
          }
          const region = awsRegionSchema.safeParse(options.region);
          if (!region.success) throw new Error("Managed AWS keys need --region <region>, e.g. us-east-1.");
          const secret = await inputSecret(input, `${PROVIDER_LABELS[aws]} API key`);
          return changeCredentials({ action: "add", name, secret, aws: { provider: aws, region: region.data } });
        });
        return;
      }
      if (targeted()) throw new Error("Target keys use --auth api-key with a managed provider. Legacy providers stay in this host's config.");
      if (options.auth || options.fromEnv || options.stdin) {
        console.error("Managed input flags require --auth api-key with --provider openai, anthropic, mantle, bedrock, cursor or gemini.");
        process.exitCode = 1;
        return;
      }
      if (new CredentialStore().read().entries[name]) {
        console.error("Name belongs to a managed key. Use keys rotate.");
        process.exitCode = 1;
        return;
      }
      if (provider === undefined) {
        provider = await select({
          message: "Provider",
          loop: false,
          choices: PROVIDERS.map((value) => ({ value, name: PROVIDER_LABELS[value] })),
        });
      }
      if (!isProvider(provider)) {
        console.error(chalk.red(`\nUnknown provider "${provider}". Use one of: ${PROVIDERS.join(", ")}.`));
        process.exit(1);
      }

      const entry = await buildEntry(provider, options);
      const existed = getProviderKey(name) !== undefined;
      try {
        setProviderKey(name, entry);
      } catch (error) {
        console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }

      console.log(chalk.green("✓") + ` ${existed ? "Updated" : "Stored"} entry "${name}" (${PROVIDER_LABELS[provider]})`);
      console.log(chalk.dim(`Assign it with 'convoy keys use ${name} [--runtime codex] [--profile <key>]'.`));
    }
  );

const listCommand = new Command("list")
  .alias("ls")
  .description("List stored providers")
  .action(async () => {
    if (targeted()) { printManagedStatus(await managedStatus()); return; }
    const hasManaged = Object.keys(new CredentialStore().read().entries).length > 0;
    if (hasManaged) printManagedStatus(await managedStatus());
    const keys = listProviderKeys();
    if (keys.length === 0 && hasManaged) return;
    if (keys.length === 0) {
      console.log(chalk.yellow("\nNo providers stored."));
      console.log(chalk.dim(`Add one with 'convoy keys add <name> --provider ${PROVIDERS.join("|")}'.`));
      return;
    }

    const profiles = listAllProfiles();
    console.log(chalk.bold("\nProvider keys:\n"));
    for (const { name, key } of keys) {
      const usedBy = profiles.flatMap(({ key: profileKey, profile }) => [
        ...(profile.provider_key === name ? [profileKey] : []),
        ...(profile.codex_provider_key === name ? [`${profileKey} (Codex)`] : []),
      ]);
      console.log(`  ${chalk.green(name)}`);
      console.log(`    Provider: ${PROVIDER_LABELS[key.provider]}`);
      console.log(`    Token:    ${chalk.dim(key.token ? maskToken(key.token) : "none (this machine's Claude sign-in)")}`);
      if (key.region) {
        console.log(`    Region:   ${key.region}`);
      }
      console.log(`    Used by:  ${usedBy.length > 0 ? usedBy.map((p) => chalk.cyan(p)).join(", ") : chalk.dim("no profiles")}`);
    }
    console.log();
  });

const removeCommand = new Command("remove")
  .alias("rm")
  .description("Delete a stored provider key")
  .argument("<name>", "Key name")
  .action(async (name: string) => {
    if (targeted() || Object.hasOwn(new CredentialStore().read().entries, name)) {
      await runManagedCommand(() => changeCredentials({ action: "remove", name }));
      return;
    }
    try {
      if (!deleteProviderKey(name)) {
        console.error(chalk.red(`\nKey "${name}" not found.`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
    console.log(chalk.green("✓") + ` Removed key "${name}"`);
  });

const useCommand = addGlobalOptions(
  new Command("use")
    .description("Assign a provider key to a profile (agents will run through it)")
    .argument("<name>", "Key name")
    .option("--runtime <runtime>", `Runtime to assign: ${RUNTIMES} (default Claude Code; required for managed keys)`)
).action(async (name: string, _options: unknown, cmd: Command) => {
  const ordinaryKey = ordinaryRuntimeProfile(cmd);
  const codexProfileKey = cmd.opts().runtime === "codex" ? ordinaryKey : undefined;
  if (codexProfileKey) {
    try {
      setProfileProviderKey(codexProfileKey, name, "codex");
    } catch (error) {
      console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
    const key = getProviderKey(name);
    console.log(chalk.green("✓") + ` Codex on profile "${codexProfileKey}" now uses key "${name}"${key ? ` (${PROVIDER_LABELS[key.provider]}, ${key.region})` : ""}`);
    console.log(chalk.dim("Restart 'convoy connect' for the change to take effect."));
    return;
  }
  if ((cmd.opts().runtime && !ordinaryKey) || (!cmd.opts().runtime && Object.hasOwn(new CredentialStore().read().entries, name))) {
    await runManagedCommand(async () => changeCredentials(managedBind(cmd, { mode: "managed", name })));
    return;
  }
  const profileKey = ordinaryKey ?? resolveProfileKeyOrExit(cmd);
  try {
    setProfileProviderKey(profileKey, name);
  } catch (error) {
    console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
  const key = getProviderKey(name);
  console.log(chalk.green("✓") + ` Profile "${profileKey}" now uses key "${name}"${key ? ` (${PROVIDER_LABELS[key.provider]})` : ""}`);
  console.log(chalk.dim("Restart 'convoy connect' for the change to take effect."));
});

const unassignCommand = addGlobalOptions(
  new Command("unassign")
    .description("Clear a profile's provider key (back to the machine's own config)")
    .option("--runtime <runtime>", `Runtime to clear: ${RUNTIMES} (default Claude Code; required for managed keys)`)
    .option("--native-login", "Explicitly restore the runtime's private native login (isolated projects)")
).action(async (_options: unknown, cmd: Command) => {
  const ordinaryKey = ordinaryRuntimeProfile(cmd);
  const codexProfileKey = cmd.opts().runtime === "codex" ? ordinaryKey : undefined;
  if (codexProfileKey) {
    try {
      setProfileProviderKey(codexProfileKey, undefined, "codex");
    } catch (error) {
      console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
    console.log(chalk.green("✓") + ` Codex on profile "${codexProfileKey}" uses the machine's Codex config again`);
    console.log(chalk.dim("Restart 'convoy connect' for the change to take effect."));
    return;
  }
  if ((cmd.opts().runtime && !ordinaryKey) || cmd.opts().nativeLogin) {
    await runManagedCommand(async () => changeCredentials(managedBind(cmd, { mode: cmd.opts().nativeLogin ? "native" : "disabled" })));
    return;
  }
  const profileKey = ordinaryKey ?? resolveProfileKeyOrExit(cmd);
  try {
    setProfileProviderKey(profileKey, undefined);
  } catch (error) {
    console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
  console.log(chalk.green("✓") + ` Profile "${profileKey}" uses the machine's Claude config again`);
});

const statusCommand = new Command("status")
  .description("Show managed credential revisions and observed project assignments")
  .option("--json", "Machine-readable status")
  .action((opts) =>
    runManagedCommand(async () => {
      printManagedStatus(await managedStatus(), !!opts.json);
    })
  );

const rotateCommand = new Command("rotate")
  .description("Store a replacement API key and enable the entry")
  .argument("<name>", "Managed key name")
  .option("--from-env <name>", "Import from an environment variable")
  .option("--stdin", "Read the key from stdin")
  .action((name, opts) => runManagedCommand(async () => changeCredentials({ action: "rotate", name, secret: await inputSecret(opts, "Replacement API key") })));

const rollbackCommand = new Command("rollback")
  .description("Select a retained revision without changing enabled state")
  .argument("<name>", "Managed key name")
  .requiredOption("--revision <revision>", "Retained revision number")
  .action((name, opts) => runManagedCommand(() => changeCredentials({ action: "rollback", name, revision: Number(opts.revision) })));

const disableCommand = new Command("disable")
  .description("Prevent future grants of a managed key")
  .argument("<name>", "Managed key name")
  .action((name) => runManagedCommand(() => changeCredentials({ action: "disable", name })));

export const keysCommand = new Command("keys")
  .description("Manage local API keys for isolated Codex, Claude Code, Cursor, Antigravity and OpenCode, and Claude providers")
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(useCommand)
  .addCommand(unassignCommand)
  .addCommand(statusCommand)
  .addCommand(rotateCommand)
  .addCommand(rollbackCommand)
  .addCommand(disableCommand);
