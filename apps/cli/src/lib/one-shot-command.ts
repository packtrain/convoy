import chalk from "chalk";
import type { Command } from "commander";
import {
  ConfigError,
  createConvexClient,
  handleConfigError,
  type ConvoyClient,
  type RequiredConfig,
} from "./config/index.js";
import { toUserFacingError } from "./convex-error.js";
import { resolveOneShotConfig } from "./one-shot-config.js";

export interface OneShotCommandContext {
  config: RequiredConfig;
  client: ConvoyClient;
}

export async function runOneShotCommand(
  cmd: Command,
  run: (context: OneShotCommandContext) => Promise<void>
): Promise<void> {
  let client: ConvoyClient | undefined;

  try {
    const config = resolveOneShotConfig(cmd);
    client = createConvexClient({
      url: config.convexUrl,
      apiKey: config.apiKey,
    });

    await run({ config, client });
  } catch (error) {
    if (error instanceof ConfigError) {
      handleConfigError(error);
      return;
    }

    // `--cursor` is only declared on paginated commands, so this is undefined
    // elsewhere and the cursor hint stays out of unrelated errors.
    const cursor = cmd.opts().cursor;
    console.error(
      chalk.red(
        `Error: ${toUserFacingError(error, typeof cursor === "string" ? cursor : undefined)}`
      )
    );
    process.exit(1);
  } finally {
    await client?.close();
  }
}
