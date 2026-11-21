import { readFile, stat } from "node:fs/promises";
import type { AcpContentBlock } from "../acp/client.js";
import {
  createSandboxUnsupportedRunner,
  type CliRuntimeDefinition,
  type PreparedRuntimeExecution,
  type RuntimeExecutionInput,
} from "../contracts.js";
import { formatUserMessageBlock } from "../message-format.js";
import { detectAntigravity } from "./detect.js";
import { isAntigravityModel } from "./models.js";
import { createAntigravityRunner } from "./runner.js";
import { antigravityChunkStreamPolicy } from "./streaming.js";

/** agy's `promptCapabilities.image` types, and t3code's limits for them. */
const INLINE_IMAGE_TYPES = new Set(["image/bmp", "image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;

/** Antigravity CLI (`agy acp`). Spec: docs/specs/cli-antigravity-runtime.md. */
export const antigravityRuntime: CliRuntimeDefinition = {
  type: "antigravity",
  // `_meta.antigravity.systemPrompt.append` on every session/new and session/resume.
  agentPromptDelivery: "system-append",
  detectAvailableCli: detectAntigravity,
  createRunner: (options) =>
    // Unverified whether `agy acp --sandbox` honors writable roots, so isolation fails fast.
    options.sandbox
      ? createSandboxUnsupportedRunner("antigravity")
      : createAntigravityRunner({ partialStreaming: options.partialStreaming }),
  normalizeCliModel: (model) => (isAntigravityModel(model) ? model : undefined),
  isInlineImageAttachment: (contentType) => INLINE_IMAGE_TYPES.has(contentType.toLowerCase()),
  async prepareRunExecution(input: RuntimeExecutionInput): Promise<PreparedRuntimeExecution> {
    // A solo runtime command is sent raw so agy runs it ("/compact").
    const [command] = input.messages;
    if (input.messages.length === 1 && command.runtimeCommand === true) {
      return { prompt: command.contentText.trim(), rawRuntimeCommand: true, inputFormat: "prompt" };
    }

    // Images go to session/prompt as blocks; over the limits they stay path references.
    const images: AcpContentBlock[] = [];
    let imageBytes = 0;
    const formattedMessages: string[] = [];
    for (const [index, entry] of input.messages.entries()) {
      const pathAttachments = [];
      for (const attachment of entry.attachments) {
        const size = attachment.inlineImage ? await stat(attachment.localPath).then((info) => info.size, () => Infinity) : Infinity;
        if (size > MAX_IMAGE_BYTES || imageBytes + size > MAX_TOTAL_IMAGE_BYTES) {
          pathAttachments.push(attachment);
          continue;
        }
        imageBytes += size;
        images.push(
          { type: "text", text: `user-message-${index + 1} attachment: ${JSON.stringify(attachment.fileName)} (${attachment.contentType})` },
          { type: "image", mimeType: attachment.contentType.toLowerCase(), data: (await readFile(attachment.localPath)).toString("base64") }
        );
      }
      formattedMessages.push(formatUserMessageBlock({ index, message: entry, attachments: pathAttachments }));
    }
    return {
      prompt: ["Convoy user messages for this run:", formattedMessages.join("\n\n")].join("\n\n"),
      inputFormat: "prompt",
      ...(images.length > 0 ? { bootstrapInput: images } : {}),
    };
  },
  getChunkStreamPolicy: () => antigravityChunkStreamPolicy,
};
