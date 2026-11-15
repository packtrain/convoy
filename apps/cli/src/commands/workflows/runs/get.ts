import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { formatRunDetail } from "./formatters.js";

export const getRunCommand = addGlobalOptions(
  addOutputOptions(new Command("get").description("Show a run's stages and steps").argument("<runId>", "Run ID"))
).action(async (runId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const run = await client.query(api.workflows.runs.core.get, { runId: parseId<"workflowRuns">(runId, "runId") });
    if (!run) {
      throw new Error("Run not found or not accessible.");
    }

    printOutput(outputMode, run, (value) => {
      console.log();
      for (const line of formatRunDetail(value)) {
        console.log(line);
      }
    });
  });
});
