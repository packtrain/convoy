import { describe, expect, it } from "vitest";
import type {
  Options as ClaudeQueryOptions,
  PermissionResult,
  Query,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  buildClaudeAgentQueryOptions,
  runClaudeAgentSdkPrompt,
} from "../claude-agent-sdk-runner.js";

class FakeQuery implements Query {
  private index = 0;
  closeCalls = 0;

  constructor(private readonly messages: SDKMessage[]) {}

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    const message = this.messages[this.index];
    this.index += 1;

    if (!message) {
      return { done: true, value: undefined };
    }

    return { done: false, value: message };
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    throw error;
  }

  [Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
    return this;
  }

  async interrupt(): Promise<void> {}

  async setPermissionMode(): Promise<void> {}

  async setModel(): Promise<void> {}

  async setMaxThinkingTokens(): Promise<void> {}

  close(): void {
    this.closeCalls += 1;
  }
}

function systemInitMessage(sessionId: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "user",
    claude_code_version: "2.1.112",
    cwd: "/tmp/project",
    tools: ["Read", "Edit"],
    mcp_servers: [],
    model: "claude-sonnet-4-6",
    permissionMode: "bypassPermissions",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: sessionId,
  };
}

describe("claude agent sdk runner", () => {
  it("builds full-access SDK options with explicit dangerous bypass acknowledgment", () => {
    const options = buildClaudeAgentQueryOptions({
      cwd: "/tmp/project",
      permissionMode: "bypassPermissions",
      promptForInput: async () => "",
    });

    expect(options.cwd).toBe("/tmp/project");
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(options.tools).toEqual({ type: "preset", preset: "claude_code" });
    expect(typeof options.canUseTool).toBe("function");
  });

  it("uses SDK resume plus forkSession for follow-up turns", () => {
    const options = buildClaudeAgentQueryOptions({
      cwd: "/tmp/project",
      resumeSessionId: "00000000-0000-4000-8000-000000000123",
      promptForInput: async () => "",
    });

    expect(options.resume).toBe("00000000-0000-4000-8000-000000000123");
    expect(options.forkSession).toBe(true);
  });

  it("routes AskUserQuestion through canUseTool answers", async () => {
    const options = buildClaudeAgentQueryOptions({
      cwd: "/tmp/project",
      permissionMode: "bypassPermissions",
      promptForInput: async () => "React",
    });

    const result = (await options.canUseTool?.(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "React", description: "React.js" },
              { label: "Vue", description: "Vue.js" },
            ],
          },
        ],
      },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-ask-1",
      }
    )) as PermissionResult;

    expect(result.behavior).toBe("allow");
    expect(result.updatedInput).toEqual({
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [
            { label: "React", description: "React.js" },
            { label: "Vue", description: "Vue.js" },
          ],
        },
      ],
      answers: {
        "Which framework?": "React",
      },
    });
  });

  it("streams SDK messages and returns the observed session id", async () => {
    let captured:
      | {
          prompt: string;
          options: ClaudeQueryOptions;
        }
      | undefined;
    const fakeQuery = new FakeQuery([
      systemInitMessage("00000000-0000-4000-8000-000000000456"),
    ]);

    const result = await runClaudeAgentSdkPrompt({
      cwd: "/tmp/project",
      prompt: "hello",
      rawJson: false,
      createQuery: (input) => {
        captured = input;
        return fakeQuery;
      },
      promptForInput: async () => "",
      renderMessage: () => undefined,
    });

    expect(captured?.prompt).toBe("hello");
    expect(captured?.options.permissionMode).toBe("bypassPermissions");
    expect(result.sessionId).toBe("00000000-0000-4000-8000-000000000456");
    expect(fakeQuery.closeCalls).toBe(1);
  });
});
