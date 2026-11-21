import { checkbox, select } from "@inquirer/prompts";
import { InitError } from "./errors.js";
import {
  CLAUDE_METHODS,
  type ClaudeMethod,
  INIT_SCOPES,
  type InitScope,
  INIT_TARGETS,
  type InitTarget,
} from "./types.js";

export async function resolveSkillTargets(
  targets: InitTarget[] | undefined
): Promise<InitTarget[]> {
  if (targets && targets.length > 0) {
    return targets;
  }

  if (targets && targets.length === 0 && !process.stdin.isTTY) {
    throw new InitError(
      `No CLI targets selected. Pass --cli ${INIT_TARGETS.join(",")} in non-interactive mode.`
    );
  }

  return checkbox<InitTarget>({
    message: "Which CLI(s) should get Convoy skills?",
    choices: [
      {
        value: "claude",
        name: "Claude Code",
        checked: true,
      },
      {
        value: "codex",
        name: "Codex",
        checked: true,
      },
      {
        value: "opencode",
        name: "OpenCode",
        checked: true,
      },
      {
        // Unchecked: agy's MCP config is per user, not per project.
        value: "antigravity",
        name: "Antigravity",
        checked: false,
      },
    ],
    required: true,
    loop: false,
  });
}

export async function resolveScope(
  scope: InitScope | undefined
): Promise<InitScope> {
  if (scope) {
    return scope;
  }

  if (!process.stdin.isTTY) {
    throw new InitError(
      `No scope specified. Pass --scope ${INIT_SCOPES.join("|")} in non-interactive mode.`
    );
  }

  return select<InitScope>({
    message: "Where should skills be installed?",
    choices: [
      { value: "project", name: "Project (shared with team)" },
      { value: "user", name: "User (all your projects)" },
    ],
    loop: false,
  });
}

export async function resolveClaudeMethods(
  methods: ClaudeMethod[] | undefined
): Promise<ClaudeMethod[]> {
  if (methods && methods.length > 0) {
    return methods;
  }

  if (!process.stdin.isTTY) {
    throw new InitError(
      `No Claude method specified. Pass --claude-method ${CLAUDE_METHODS.join(",")} in non-interactive mode.`
    );
  }

  return checkbox<ClaudeMethod>({
    message: "How should the Claude Code skill be installed?",
    choices: [
      {
        value: "plugin",
        name: "Plugin (richer - includes commands, hooks, agents)",
        checked: true,
      },
      {
        value: "raw",
        name: "Raw skill files (simpler - self-contained)",
        checked: true,
      },
    ],
    required: true,
    loop: false,
  });
}
