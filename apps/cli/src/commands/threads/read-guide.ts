import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";

type RunGuide = NonNullable<FunctionReturnType<typeof api.integrations.github.guides.readForRun>>;

const NO_BASE = "This guide run has no base guide: it was deleted, or the run writes a new guide. Write a plain guide, without unchangedFrom or updatedFrom.";

export const readGuideCommand = addGlobalOptions(
  new Command("read-guide")
    .description("Print the Guide this thread is writing, or with --base the Guide it follows up, as JSON")
    .argument("<threadId>", "Thread ID of the Guide run")
    .option("--base", "The Follow-up guide's base: the steps unchangedFrom and updatedFrom number")
).action(async (threadId: string, options: { base?: boolean }, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const guide: RunGuide | null = await client.query(api.integrations.github.guides.readForRun, { threadId: parseId<"cliThreads">(threadId, "threadId"), base: options.base });
    if (!guide) {
      console.log(NO_BASE);
      return;
    }
    // Numbered from 1 as unchangedFrom and updatedFrom count; blob SHAs are Convoy's.
    const steps = guide.steps.map((step: RunGuide["steps"][number], at: number) => ({ number: at + 1, ...step, files: step.files.map(({ path, note }: RunGuide["steps"][number]["files"][number]) => ({ path, ...(note ? { note } : {}) })) }));
    console.log(JSON.stringify({ guideId: guide._id, status: guide.status, headSha: guide.headSha, steps }, null, 2));
  });
});
