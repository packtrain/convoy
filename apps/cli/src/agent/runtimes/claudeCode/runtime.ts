import type {
  CliRuntimeDefinition,
  CliRuntimeRunnerFactoryOptions,
  PreparedRuntimeExecution,
  RuntimeExecutionInput,
} from "../contracts.js";
import { formatUserMessageBlock } from "../message-format.js";
import { detectClaudeCode } from "./detect.js";
import { isClaudeCodeModelSlot } from "./models.js";
import { createClaudeCodeRunner, createFileStreamRunner } from "./runner.js";
import { claudeCodeChunkStreamPolicy } from "./streaming.js";

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function buildRunPrompt(input: RuntimeExecutionInput): string {
  const formattedMessages = input.messages
    .map((message, index) => {
      const nonImageAttachments = message.attachments.filter(
        (attachment) => !attachment.inlineImage,
      );
      return formatUserMessageBlock({
        index,
        message,
        attachments: nonImageAttachments,
      });
    })
    .join("\n\n");

  return ["Convoy user messages for this run:", formattedMessages].join("\n\n");
}

async function buildStreamJsonBootstrapInput(
  input: RuntimeExecutionInput,
): Promise<unknown[] | undefined> {
  const imageAttachments = input.messages.flatMap((message) =>
    message.attachments.filter((attachment) => attachment.inlineImage),
  );

  if (imageAttachments.length === 0) {
    return undefined;
  }

  const { readFile } = await import("node:fs/promises");

  const content: unknown[] = [
    {
      type: "text",
      text: "Convoy user messages for this run with attachments:",
    },
  ];

  for (const [index, message] of input.messages.entries()) {
    const imageMessageAttachments = message.attachments.filter(
      (attachment) => attachment.inlineImage,
    );
    const nonImageAttachments = message.attachments.filter(
      (attachment) => !attachment.inlineImage,
    );

    content.push({
      type: "text",
      text: formatUserMessageBlock({
        index,
        message,
        attachments: nonImageAttachments,
      }),
    });

    for (const attachment of imageMessageAttachments) {
      const imageBuffer = await readFile(attachment.localPath);
      content.push({ type: "text", text: `attachment: ${JSON.stringify(attachment.fileName)} (${attachment.contentType})` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.contentType,
          data: imageBuffer.toString("base64"),
        },
      });
    }
  }

  return [
    {
      type: "user",
      message: {
        role: "user",
        content,
      },
    },
  ];
}

function createRunner(options: CliRuntimeRunnerFactoryOptions) {
  if (options.streamFile) {
    return createFileStreamRunner(options.streamFile, {
      delayMs: options.streamDelayMs,
    });
  }
  return createClaudeCodeRunner({
    includePartialMessages: options.partialStreaming ?? false,
    sandbox: options.sandbox,
    claudeAuth: options.claudeAuth,
  });
}

const VCS_SIGNAL_SUBTYPES = new Set(["vcs_state_changed", "code_change_published"]);

export const claudeCodeRuntime: CliRuntimeDefinition = {
  type: "claude-code",
  // Agent SDK systemPrompt preset append, re-passed on every run.
  agentPromptDelivery: "system-append",
  detectAvailableCli: detectClaudeCode,
  createRunner,
  signalsVcsStateChange(chunk) {
    if (chunk.type !== "system") {
      return false;
    }
    try {
      const parsed = JSON.parse(chunk.data) as { subtype?: unknown };
      return typeof parsed.subtype === "string" && VCS_SIGNAL_SUBTYPES.has(parsed.subtype);
    } catch {
      return false;
    }
  },
  normalizeCliModel(model) {
    return isClaudeCodeModelSlot(model) ? model : undefined;
  },
  isInlineImageAttachment(contentType) {
    return SUPPORTED_IMAGE_MIME_TYPES.has(contentType.toLowerCase());
  },
  async prepareRunExecution(
    input: RuntimeExecutionInput,
  ): Promise<PreparedRuntimeExecution> {
    // A runtime command run (always solo — the thread processor slices at
    // command boundaries) is delivered raw so the Agent SDK interprets it
    // ("/compact", custom commands, skills) instead of reading it as prose.
    const command = input.messages.length === 1 && input.messages[0].runtimeCommand ? input.messages[0] : undefined;
    if (command) {
      const usage = command.contentText.trim().match(/^\/usage(?:\s+(.*))?$/s);
      if (usage) {
        return { prompt: "", inputFormat: "prompt", runtimeCommand: {
          command: "usage", ...(usage[1] ? { arguments: usage[1] } : {}),
        } };
      }
      return {
        prompt: command.contentText.trim(),
        inputFormat: "prompt",
      };
    }

    const bootstrapInput = await buildStreamJsonBootstrapInput(input);
    return {
      prompt: buildRunPrompt(input),
      inputFormat: bootstrapInput ? "stream-json" : "prompt",
      bootstrapInput,
    };
  },
  getChunkStreamPolicy: () => claudeCodeChunkStreamPolicy,
};
