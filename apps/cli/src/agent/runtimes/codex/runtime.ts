import type {
  CliRuntimeDefinition,
  PreparedRuntimeExecution,
  RuntimeExecutionInput,
} from "../contracts.js";
import { formatUserMessageBlock } from "../message-format.js";
import { createCodexAppServerRunner } from "./app-server-runner.js";
import { isCodexAppServerCommand } from "./commands.js";
import { detectCodex } from "./detect.js";
import { isCodexModelSlot } from "./models.js";
import { createCodexRunner } from "./runner.js";
import { codexChunkStreamPolicy } from "./streaming.js";

/**
 * A solo runtime-command run ("/compact") parsed into a dedicated RPC invocation
 * (OS-1582). Codex does not interpret slash text in `turn/start` — in the TUI these are
 * client-side affordances — so raw text would reach the model as prose, which it answers
 * as if it had run the command. Null for anything the runner cannot execute, so the
 * caller falls back to the normal run envelope.
 */
export function parseSoloCodexCommand(
  messages: RuntimeExecutionInput["messages"],
): PreparedRuntimeExecution | null {
  if (messages.length !== 1 || messages[0].runtimeCommand !== true) {
    return null;
  }
  const text = messages[0].contentText.trim();
  const withoutSlash = text.startsWith("/") ? text.slice(1) : text;
  const spaceIndex = withoutSlash.search(/\s/);
  const command = spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
  if (!isCodexAppServerCommand(command)) {
    return null;
  }
  const commandArguments = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1).trim();

  return {
    prompt: text,
    inputFormat: "prompt",
    runtimeCommand: {
      command,
      ...(commandArguments.length > 0 ? { arguments: commandArguments } : {}),
    },
  };
}

export const codexRuntime: CliRuntimeDefinition = {
  type: "codex",
  // Transport-dependent: the app-server transport appends per-thread
  // `developerInstructions` through the RPC (thread/start and thread/resume,
  // re-passed on every run); the default `codex exec` transport has no
  // per-thread RPC channel and falls back to first-message delivery.
  agentPromptDelivery: "system-append",
  detectAvailableCli: detectCodex,
  createRunner: (options) =>
    (options.codexAppServer || options.codexAuth || options.codexProvider)
      ? createCodexAppServerRunner({
          codexAuth: options.codexAuth,
          codexProvider: options.codexProvider,
          partialStreaming: options.partialStreaming,
          sandbox: options.sandbox,
        })
      : createCodexRunner({ sandbox: options.sandbox }),
  normalizeCliModel(model) {
    return isCodexModelSlot(model) ? model : undefined;
  },
  isInlineImageAttachment() {
    return false;
  },
  async prepareRunExecution(
    input: RuntimeExecutionInput,
  ): Promise<PreparedRuntimeExecution> {
    const soloCommand = parseSoloCodexCommand(input.messages);
    if (soloCommand) {
      return soloCommand;
    }

    const formattedMessages = input.messages
      .map((message, index) =>
        formatUserMessageBlock({
          index,
          message,
          attachments: message.attachments,
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
    return codexChunkStreamPolicy;
  },
};
