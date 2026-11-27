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
import { watchPullRequestCommand } from "./watch-pr.js";
import { unwatchPullRequestCommand } from "./unwatch-pr.js";
import { listThreadChecksCommand } from "./checks.js";
import { readGuideCommand } from "./read-guide.js";
import { submitGuideCommand } from "./submit-guide.js";
import { moveWorktreeCommand } from "./move-worktree.js";

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
  .addCommand(watchPullRequestCommand)
  .addCommand(unwatchPullRequestCommand)
  .addCommand(attachToResponseCommand)
  .addCommand(listThreadChecksCommand)
  .addCommand(submitGuideCommand)
  .addCommand(readGuideCommand)
  .addCommand(moveWorktreeCommand);
