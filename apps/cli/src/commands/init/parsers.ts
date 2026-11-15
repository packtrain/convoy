import { InitError } from "./errors.js";
import {
  CLAUDE_METHODS,
  type ClaudeMethod,
  INIT_SCOPES,
  type InitScope,
  INIT_TARGETS,
  type InitTarget,
} from "./types.js";

export function parseCliTargets(
  value: string | string[] | undefined
): InitTarget[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalidTargets = normalized.filter(
    (entry) => !INIT_TARGETS.includes(entry as InitTarget)
  );
  if (invalidTargets.length > 0) {
    throw new InitError(
      `Invalid --cli target(s): ${invalidTargets.join(", ")}. Must be one of: ${INIT_TARGETS.join(", ")}`
    );
  }

  return [...new Set(normalized)] as InitTarget[];
}

export function parseScope(value: string | undefined): InitScope | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!INIT_SCOPES.includes(value as InitScope)) {
    throw new InitError(
      `Invalid scope "${value}". Must be one of: ${INIT_SCOPES.join(", ")}`
    );
  }

  return value as InitScope;
}

export function parseClaudeMethods(
  value: string | string[] | undefined
): ClaudeMethod[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalidMethods = normalized.filter(
    (entry) => !CLAUDE_METHODS.includes(entry as ClaudeMethod)
  );
  if (invalidMethods.length > 0) {
    throw new InitError(
      `Invalid --claude-method value(s): ${invalidMethods.join(", ")}. Must be one of: ${CLAUDE_METHODS.join(", ")}`
    );
  }

  return [...new Set(normalized)] as ClaudeMethod[];
}
