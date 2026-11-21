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
  isInlineImageAttachment: () => false,
  async prepareRunExecution(input: RuntimeExecutionInput): Promise<PreparedRuntimeExecution> {
    const formattedMessages = input.messages
      .map((entry, index) => formatUserMessageBlock({ index, message: entry, attachments: entry.attachments }))
      .join("\n\n");
    return {
      prompt: ["Convoy user messages for this run:", formattedMessages].join("\n\n"),
      inputFormat: "prompt",
    };
  },
  getChunkStreamPolicy: () => antigravityChunkStreamPolicy,
};
