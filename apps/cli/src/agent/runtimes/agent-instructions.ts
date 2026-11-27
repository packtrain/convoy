import type { PreparedRuntimeExecution, RunnerExecutionOptions } from "./contracts.js";

/**
 * Thread-identity prompt line (OS-1223): tells the spawned agent which
 * Convoy thread it is running in so it can reference itself via MCP
 * thread tools. Runners deliver it per their prompt channel (system-append
 * or first-message); most also export it as CONVOY_THREAD_ID.
 */
export function threadIdentityInstruction(threadId: string): string {
  return `Your Convoy thread ID is ${threadId}. Reference it when calling Convoy MCP thread tools about the current thread.`;
}

/**
 * First-message prompt delivery (OS-1138, OS-1223): runtimes without a per-invocation
 * system-prompt append channel prepend the bound Project agent's prompt and the
 * thread-identity line to the first message of a fresh session. Resumed sessions get no
 * injection — the runtime's own transcript already carries both. Block format:
 * `docs/specs/cli-thread-agents.md` ("Prompt Delivery").
 */
export function withFirstMessageAgentInstructions(
  prompt: string,
  options: Pick<
    RunnerExecutionOptions,
    "agentPrompt" | "agentName" | "continuationId" | "threadId" | "workspaceNotice" | "rawRuntimeCommand"
  >,
): string {
  if (options.rawRuntimeCommand) return prompt;
  if (options.workspaceNotice) prompt = `${options.workspaceNotice}\n\n${prompt}`;
  if (options.continuationId) {
    return prompt;
  }

  const parts: string[] = [];

  if (options.agentPrompt) {
    // Not real XML — the attribute only needs to stay readable for the model.
    const name = options.agentName?.replace(/"/g, "'");
    const openTag = name
      ? `<agent-instructions agent="${name}">`
      : "<agent-instructions>";
    parts.push([openTag, options.agentPrompt, "</agent-instructions>"].join("\n"));
  }

  parts.push(threadIdentityInstruction(options.threadId));

  return [parts.join("\n\n"), "", prompt].join("\n");
}

/**
 * Per-run attach command (OS-2091): names this run's reply and session so a slow
 * upload from an old run cannot land on a newer one, and names the checks command
 * (OS-2291). Every normal run gets it, resumed ones too. Spec: `docs/specs/cli-thread-agents.md`.
 */
export function withRunAttachmentInstructions(
  execution: PreparedRuntimeExecution,
  ids: { threadId: string; messageId: string; sessionId: string },
): PreparedRuntimeExecution {
  const line =
    "To attach files (screenshots, logs, generated files) to your reply in this Convoy thread, run: " +
    `convoy threads attach ${ids.threadId} <file...> --message-id ${ids.messageId} --session-id ${ids.sessionId}` +
    ". Add --caption \"<what to look at>\" once per file, in file order, so the user knows where to look in a screenshot." +
    " For a chart or table page, attach an .html file with --inline and follow the Convoy skill's inline HTML guide." +
    " To report a check, add --check <key> and one of --passed, --warning, --failed or --not-performed (the last three need --note <why>), plus --value <answer> or --artifact <artifactId> when the check asks for one;" +
    ` \`convoy threads checks ${ids.threadId}\` lists the checks.`;
  return withPromptLine(execution, line);
}

/** A multi-repo folder's repos, by relative path. Spec: docs/specs/cli-multi-repo-projects.md#agent-context */
export function repositoryContextInstruction(relativePaths: string[]): string {
  return `This folder contains git repositories: ${relativePaths.join(", ")}.`;
}

/** Append one line to a run's prompt, on every runtime's input format. */
export function withPromptLine(execution: PreparedRuntimeExecution, line: string): PreparedRuntimeExecution {
  // Claude's stream-json input replaces the text prompt, so the line rides in its last frame too.
  // Other bootstrap input (Antigravity's image blocks) goes alongside the text prompt and stays as is.
  const frames = execution.inputFormat === "stream-json"
    ? execution.bootstrapInput as Array<{ message: { content: unknown } }> | undefined
    : undefined;
  const last = frames?.at(-1);
  // Anthropic message content is a string or a block array; a string becomes one text block.
  const lastContent = typeof last?.message.content === "string"
    ? [{ type: "text", text: last.message.content }]
    : Array.isArray(last?.message.content) ? last.message.content : [];
  return {
    ...execution,
    prompt: `${execution.prompt}\n\n${line}`,
    ...(frames && last
      ? {
          bootstrapInput: [
            ...frames.slice(0, -1),
            { ...last, message: { ...last.message, content: [...lastContent, { type: "text", text: line }] } },
          ],
        }
      : {}),
  };
}
