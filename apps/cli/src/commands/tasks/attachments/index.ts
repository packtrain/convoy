import { Command } from "commander";
import { listTaskAttachmentsCommand } from "./list.js";
import { downloadTaskAttachmentCommand } from "./download.js";
import { moveTaskAttachmentCommand } from "./move.js";
import { deleteTaskAttachmentCommand } from "./delete.js";

export const taskAttachmentsCommand = new Command("attachments")
  .alias("attachment")
  .description("Task attachment commands")
  .addCommand(listTaskAttachmentsCommand)
  .addCommand(downloadTaskAttachmentCommand)
  .addCommand(moveTaskAttachmentCommand)
  .addCommand(deleteTaskAttachmentCommand);
