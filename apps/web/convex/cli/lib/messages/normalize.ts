import type { Doc, Id } from "../../../_generated/dataModel";
import {
  normalizeCliEffortForStorage,
  normalizeCliModelForStorage,
} from "../runtimes/registry";
import type { CliEffort, CliMessageSentBy, CliModel, CliScriptRequest, CliType, ImageDimensions } from "../../../lib/contracts/validators";
import type { AttachedPullRequest } from "../../../lib/contracts/github";
import type { CliMessageSelection } from "../lastUsedCli";

type MessageData = Omit<Doc<"cliMessages">, "_id" | "_creationTime">;

/**
 * Put a composer selection into storage form. Extracted so `threads.create` can
 * stamp `metadata.cli` (OS-1454) in the same insert without normalizing twice.
 *
 * `cliMode` passes through: there is no mode catalog on the server, so modes are
 * validated where the catalog lives (`resolveChatDetailMode`).
 */
export function normalizeMessageSelection(args: {
  cliType: CliType;
  cliMode?: string;
  cliModel?: CliModel;
  cliEffort?: CliEffort;
}): CliMessageSelection {
  return {
    cliMode: args.cliMode,
    cliModel: normalizeCliModelForStorage({
      cliType: args.cliType,
      cliModel: args.cliModel,
    }),
    cliEffort: normalizeCliEffortForStorage({
      cliType: args.cliType,
      cliEffort: args.cliEffort,
    }),
  };
}

export function createUserMessage(args: {
  threadId: Id<"cliThreads">;
  profileId: Id<"cliProfiles">;
  cliType: CliType;
  cliMode?: string;
  cliModel?: CliModel;
  cliEffort?: CliEffort;
  taskId?: Id<"tasks">;
  pullRequest?: AttachedPullRequest;
  content: string;
  processedContent?: string;
  runtimeCommand?: boolean;
  queueFirst?: boolean;
  /** Steer requested at send time (OS-1873); the caller gates on availability. */
  steerRequestedAt?: number;
  /** Non-human sender (OS-1162); unset for the composer paths. */
  sentBy?: CliMessageSentBy;
  /** The run step that dispatched this message (OS-1868); unset for the composer paths. */
  workflowRunStepId?: Id<"workflowRunSteps">;
  /** A Bash step's script (OS-1886): the CLI runs it instead of prompting the agent. */
  scriptRequest?: CliScriptRequest;
  attachments?: Array<{
    storageId: Id<"_storage">;
    fileName: string;
    fileSize: number;
    contentType: string;
    uploadedAt: number;
    dimensions?: ImageDimensions;
  }>;
  timestamp: number;
}): MessageData {
  const attachments = args.attachments ?? [];

  return {
    threadId: args.threadId,
    role: "user",
    profileId: args.profileId,
    cliType: args.cliType,
    ...normalizeMessageSelection(args),
    taskId: args.taskId,
    pullRequest: args.pullRequest,
    attachments,
    nextChunkOrder: 0,
    content: [],
    processedContent: args.processedContent,
    runtimeCommand: args.runtimeCommand,
    queueFirst: args.queueFirst,
    steerRequestedAt: args.steerRequestedAt,
    sentBy: args.sentBy,
    workflowRunStepId: args.workflowRunStepId,
    scriptRequest: args.scriptRequest,
    status: "completed",
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  };
}
