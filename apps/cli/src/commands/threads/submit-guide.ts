import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import chalk from "chalk";
import { Command } from "commander";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

/** The steps' shape is checked by Convoy, which names what's wrong. */
type GuideFile = Pick<FunctionArgs<typeof api.integrations.github.guides.submit>, "headSha" | "steps">;

/** The Guide JSON from a file, or stdin for `-`. */
async function readGuide(source: string): Promise<GuideFile> {
  const raw = source === "-" ? await text(process.stdin) : await readFile(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source === "-" ? "stdin" : source} is not valid JSON: ${(error as Error).message}`);
  }
  const guide = parsed as Partial<GuideFile> | null;
  if (typeof guide?.headSha !== "string" || !Array.isArray(guide.steps)) {
    throw new Error('A guide is a JSON object with "headSha" (the commit it describes) and "steps".');
  }
  return { headSha: guide.headSha, steps: guide.steps as GuideFile["steps"] };
}

export const submitGuideCommand = addGlobalOptions(
  addOutputOptions(
    new Command("submit-guide")
      .description("Submit the pull request Guide this thread was started to write")
      .argument("<threadId>", "Thread ID of the Guide run")
      .argument("<file>", 'Guide JSON: { "headSha", "steps" }, or - for stdin')
  )
).action(async (threadId: string, file: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const guide = await readGuide(file);
    const result = await client.action(api.integrations.github.guides.submit, { threadId: parseId<"cliThreads">(threadId, "threadId"), ...guide });
    if (result.status === "rejected") {
      throw new Error(`Convoy did not accept the guide. Fix these and submit again:\n${result.errors.map((error: string) => `- ${error}`).join("\n")}`);
    }
    printOutput(resolveOutputMode(options), result, () => {
      console.log(chalk.green("✓") + " Guide submitted");
      console.log();
    });
  });
});
