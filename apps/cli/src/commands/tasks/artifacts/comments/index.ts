import { Command } from "commander";
import { listArtifactCommentsCommand } from "./list.js";
import { addArtifactCommentCommand } from "./add.js";
import { replyArtifactCommentCommand } from "./reply.js";
import {
  resolveArtifactCommentsCommand,
  unresolveArtifactCommentsCommand,
} from "./resolve.js";

export const artifactCommentsCommand = new Command("comments")
  .description("Artifact comment commands")
  .addCommand(listArtifactCommentsCommand)
  .addCommand(addArtifactCommentCommand)
  .addCommand(replyArtifactCommentCommand)
  .addCommand(resolveArtifactCommentsCommand)
  .addCommand(unresolveArtifactCommentsCommand);
