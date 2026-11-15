import type {
  AgentPromptDelivery,
  ChunkStreamPolicy,
  CliRuntimeDefinition,
  CliRuntimeDetectOptions,
  CliRuntimeRunner,
  CliRuntimeRunnerFactoryOptions,
  ContentChunk,
  DetectedCli,
  PreparedRuntimeExecution,
  RuntimeExecutionInput,
} from "./contracts.js";
import { claudeCodeRuntime } from "./claudeCode/runtime.js";
import { codexRuntime } from "./codex/runtime.js";
import { cursorRuntime } from "./cursor/runtime.js";
import { opencodeRuntime } from "./opencode/runtime.js";
import { RunnerExecutionError } from "./contracts.js";
import { MANAGED_RUNTIME_LABELS } from "../../lib/config/credentials/validators.js";

const runtimeDefinitions: Record<string, CliRuntimeDefinition> = {
  "claude-code": claudeCodeRuntime,
  opencode: opencodeRuntime,
  cursor: cursorRuntime,
  codex: codexRuntime,
};

/** The project launcher lists the tested runtimes it found root-owned at launch. */
function allowedInProject(cliType: string): boolean {
  return !process.env.CONVOY_PROJECT_IDENTITY ||
    (process.env.CONVOY_PROJECT_RUNTIMES ?? "").split(",").includes(cliType);
}

function getRuntimeDefinition(
  cliType: string,
): CliRuntimeDefinition | undefined {
  return runtimeDefinitions[cliType];
}

export async function detectAvailableClis(options?: CliRuntimeDetectOptions): Promise<DetectedCli[]> {
  const available = await Promise.all(
    Object.values(runtimeDefinitions).filter((runtime) => allowedInProject(runtime.type)).map((runtime) =>
      runtime.detectAvailableCli(options),
    ),
  );
  return available.filter(
    (runtime): runtime is DetectedCli => runtime !== null,
  );
}

export function createRunnerForCliType(
  cliType: string,
  options: CliRuntimeRunnerFactoryOptions,
): CliRuntimeRunner | null {
  if (!allowedInProject(cliType)) {
    return {
      // Fail through the normal per-run lifecycle so claims and the queue recover.
      // eslint-disable-next-line require-yield
      async *execute() {
        throw new RunnerExecutionError(`${cliType} is not available in this project. Isolated projects run ${Object.values(MANAGED_RUNTIME_LABELS).join(", ")} installed root-owned, for example under /usr/local/bin.`);
      },
      abort() {},
      async shutdown() {},
    };
  }
  const runtime = getRuntimeDefinition(cliType);
  if (!runtime) {
    return null;
  }
  return runtime.createRunner(options);
}

export function getAgentPromptDelivery(
  cliType: string,
): AgentPromptDelivery | undefined {
  return getRuntimeDefinition(cliType)?.agentPromptDelivery;
}

export function normalizeCliRuntimeModel(
  cliType: string,
  model: unknown,
): string | undefined {
  return getRuntimeDefinition(cliType)?.normalizeCliModel(model);
}

export function isInlineImageAttachment(
  cliType: string,
  contentType: string,
): boolean {
  return (
    getRuntimeDefinition(cliType)?.isInlineImageAttachment(contentType) ?? false
  );
}

export function getChunkStreamPolicy(
  cliType: string,
): ChunkStreamPolicy | null {
  return getRuntimeDefinition(cliType)?.getChunkStreamPolicy?.() ?? null;
}

/** Chunk signals repo state changed mid-run (commit, branch switch, PR publish). */
export function signalsVcsStateChange(
  cliType: string,
  chunk: ContentChunk,
): boolean {
  return (
    getRuntimeDefinition(cliType)?.signalsVcsStateChange?.(chunk) ?? false
  );
}

export async function prepareRunExecution(
  cliType: string,
  input: RuntimeExecutionInput,
): Promise<PreparedRuntimeExecution> {
  const runtime = getRuntimeDefinition(cliType);
  if (!runtime) {
    throw new Error(`Unsupported cliType "${cliType}" in this CLI build.`);
  }
  return runtime.prepareRunExecution(input);
}
