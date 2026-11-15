import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { getCliVersion } from "../../lib/version.js";
import { runUpdate } from "./command.js";

export const UPDATE_PROMPT_TIMEOUT_MS = 10_000;

/** True when someone can answer the update prompt. See docs/specs/cli-update-notice.md#prompt-connect-in-a-terminal-convoy-tui. */
export function canPromptForUpdate(options: { jsonEvents?: boolean; nonInteractive?: boolean; streamFile?: string }): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
    !options.jsonEvents && !options.nonInteractive && !options.streamFile && !process.env.CI;
}

/** Offer to install `latest`; true once npm succeeds. Esc and the timeout skip. */
export async function offerUpdate(latest: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_PROMPT_TIMEOUT_MS);
  const onKeypress = (_: string, key?: { name?: string }) => { if (key?.name === "escape") controller.abort(); };
  process.stdin.on("keypress", onKeypress);
  let choice: string;
  try {
    choice = await select({
      message: `Update available ${chalk.dim(`· ${getCliVersion()} →`)} ${latest}`,
      choices: [
        { name: "Update now (runs `npm install -g @useconvoy/cli@latest`)", value: "update" },
        { name: "Skip", value: "skip" },
      ],
      loop: false,
      theme: { style: { keysHelpTip: () => chalk.dim(`enter continue · esc skip · skips in ${UPDATE_PROMPT_TIMEOUT_MS / 1000}s`) } },
    }, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortPromptError") return false;
    throw error;
  } finally {
    clearTimeout(timer);
    process.stdin.off("keypress", onKeypress);
  }
  return choice === "update" && runUpdate() === 0;
}
