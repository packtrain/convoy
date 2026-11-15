import {
  createSandboxUnsupportedRunner,
  type CliRuntimeDefinition,
  type CliRuntimeRunnerFactoryOptions,
  type PreparedRuntimeExecution,
  type RuntimeExecutionInput,
} from "../contracts.js";
import { formatUserMessageBlock } from "../message-format.js";
import { detectOpencode } from "./detect.js";
import { createOpencodeRunner } from "./runner.js";
import { opencodeChunkStreamPolicy } from "./streaming.js";

/**
 * Stored values are the default slot or a `providerID/modelID` slug.
 * Keep in sync with `apps/web/convex/cli/lib/runtimes/opencode/models.ts`
 * (`isOpencodeModel`) — no shared package crosses the CLI/Convex boundary.
 */
const MODEL_SLUG_PATTERN = /^[^/\s]+\/\S+$/;

export function isOpencodeModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "default" || MODEL_SLUG_PATTERN.test(value))
  );
}

/**
 * A solo runtime-command run ("/name args") parsed into a session.command
 * invocation; OpenCode does not interpret slash text in prompts, so the
 * runner must execute the command through the dedicated endpoint.
 */
export function parseSoloRuntimeCommand(
  messages: RuntimeExecutionInput["messages"],
): PreparedRuntimeExecution | null {
  if (messages.length !== 1 || messages[0].runtimeCommand !== true) {
    return null;
  }
  const text = messages[0].contentText.trim();
  const withoutSlash = text.startsWith("/") ? text.slice(1) : text;
  const spaceIndex = withoutSlash.search(/\s/);
  const command =
    spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
  if (command.length === 0) {
    return null;
  }
  const commandArguments =
    spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1).trim();

  return {
    prompt: text,
    inputFormat: "prompt",
    runtimeCommand: {
      command,
      ...(commandArguments.length > 0 ? { arguments: commandArguments } : {}),
    },
  };
}

export const opencodeRuntime: CliRuntimeDefinition = {
  type: "opencode",
  // The per-message `system` field REPLACES opencode's default prompt, so
  // inject into the first prompt of a fresh runtime session instead.
  agentPromptDelivery: "first-message",
  detectAvailableCli: (options) => detectOpencode({ auth: options?.opencodeAuth }),
  createRunner: (options: CliRuntimeRunnerFactoryOptions) =>
    // opencode has no OS sandbox (session rulesets only): isolation (OS-1242)
    // fails fast instead of silently running unsandboxed.
    options.sandbox
      ? createSandboxUnsupportedRunner("opencode")
      : createOpencodeRunner({ partialStreaming: options.partialStreaming, opencodeAuth: options.opencodeAuth }),
  normalizeCliModel(model) {
    return isOpencodeModel(model) ? model : undefined;
  },
  isInlineImageAttachment() {
    // SDK file parts are future work; attachments are referenced by path.
    return false;
  },
  async prepareRunExecution(
    input: RuntimeExecutionInput,
  ): Promise<PreparedRuntimeExecution> {
    const soloCommand = parseSoloRuntimeCommand(input.messages);
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
    return opencodeChunkStreamPolicy;
  },
};
