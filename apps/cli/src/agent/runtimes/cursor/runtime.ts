import {
  createSandboxUnsupportedRunner,
  type CliRuntimeDefinition,
  type PreparedRuntimeExecution,
  type RuntimeExecutionInput,
} from "../contracts.js";
import { formatUserMessageBlock } from "../message-format.js";
import { detectCursorAgent } from "./detect.js";
import { isCursorModelSlot } from "./models.js";
import { createCursorRunner } from "./runner.js";
import { cursorChunkStreamPolicy } from "./streaming.js";

export const cursorRuntime: CliRuntimeDefinition = {
  type: "cursor",
  // Print mode has no system-prompt flag; inject into the first prompt of a
  // fresh runtime session (rules files would mutate the user's checkout).
  agentPromptDelivery: "first-message",
  detectAvailableCli: detectCursorAgent,
  createRunner: (options) =>
    // cursor-agent has no OS sandbox flags: isolation (OS-1242) fails fast.
    options.sandbox ? createSandboxUnsupportedRunner("cursor") : createCursorRunner({ cursorAuth: options.cursorAuth }),
  normalizeCliModel(model) {
    return isCursorModelSlot(model) ? model : undefined;
  },
  isInlineImageAttachment() {
    return false;
  },
  async prepareRunExecution(
    input: RuntimeExecutionInput,
  ): Promise<PreparedRuntimeExecution> {
    // A solo runtime command ("/name args") is delivered raw — no run
    // envelope — so cursor-agent interprets the slash command natively.
    const [message] = input.messages;
    if (input.messages.length === 1 && message.runtimeCommand === true) {
      return {
        prompt: message.contentText.trim(),
        rawRuntimeCommand: true,
        inputFormat: "prompt",
      };
    }

    const formattedMessages = input.messages
      .map((entry, index) =>
        formatUserMessageBlock({
          index,
          message: entry,
          attachments: entry.attachments,
        }),
      )
      .join("\n\n");

    return {
      prompt: ["Convoy user messages for this run:", formattedMessages].join(
        "\n\n",
      ),
      inputFormat: "prompt",
    };
  },
  getChunkStreamPolicy() {
    return cursorChunkStreamPolicy;
  },
};
