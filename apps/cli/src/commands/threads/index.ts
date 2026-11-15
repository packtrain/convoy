import { Command } from "commander";
import { listThreadsCommand } from "./list.js";
import { getThreadCommand } from "./get.js";
import { listThreadMessagesCommand } from "./messages.js";
import { createThreadCommand } from "./create.js";
import { sendThreadMessageCommand } from "./send.js";
import { markThreadDoneCommand } from "./done.js";
import { attachToResponseCommand } from "./attach.js";
import { attachTaskToThreadCommand } from "./attach-task.js";
import { attachPullRequestToThreadCommand } from "./attach-pr.js";
import { listThreadChecksCommand } from "./checks.js";

export const threadsCommand = new Command("threads")
  .description("CLI thread commands")
  .addCommand(listThreadsCommand)
  .addCommand(getThreadCommand)
  .addCommand(listThreadMessagesCommand)
  .addCommand(createThreadCommand)
  .addCommand(sendThreadMessageCommand)
  .addCommand(markThreadDoneCommand)
  .addCommand(attachTaskToThreadCommand)
  .addCommand(attachPullRequestToThreadCommand)
  .addCommand(attachToResponseCommand)
  .addCommand(listThreadChecksCommand);
