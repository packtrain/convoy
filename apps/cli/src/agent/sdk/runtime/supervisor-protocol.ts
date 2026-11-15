import type { SpawnSpec } from "../types.js";

export interface SupervisorLimits {
  terminateGraceMs: number;
  forceKillGraceMs: number;
}

export interface SupervisorStartMessage {
  type: "start";
  spec: SpawnSpec;
  limits: SupervisorLimits;
}

export interface SupervisorInterruptMessage {
  type: "interrupt";
}

export interface SupervisorTerminateMessage {
  type: "terminate";
  reason?: string;
}

export type ParentToSupervisorMessage =
  | SupervisorStartMessage
  | SupervisorInterruptMessage
  | SupervisorTerminateMessage;

export interface SupervisorStartedMessage {
  type: "started";
  pid: number | null;
}

export interface SupervisorSpawnErrorMessage {
  type: "spawn_error";
  error: string;
}

export type SupervisorToParentMessage =
  | SupervisorStartedMessage
  | SupervisorSpawnErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringRecord(
  value: unknown
): value is Record<string, string | undefined> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) => typeof item === "string" || typeof item === "undefined"
  );
}

function isTransportMode(value: unknown): value is SpawnSpec["transportMode"] {
  return value === "json-stream" || value === "line-text" || value === "pty";
}

function isSpawnSpec(value: unknown): value is SpawnSpec {
  if (!isRecord(value)) {
    return false;
  }

  if (!isString(value.command) || !isStringArray(value.args) || !isString(value.cwd)) {
    return false;
  }

  if (!isTransportMode(value.transportMode)) {
    return false;
  }

  if ("env" in value && typeof value.env !== "undefined" && !isOptionalStringRecord(value.env)) {
    return false;
  }

  if (
    "detached" in value &&
    typeof value.detached !== "undefined" &&
    typeof value.detached !== "boolean"
  ) {
    return false;
  }

  if (
    "closeStdinAfterSpawn" in value &&
    typeof value.closeStdinAfterSpawn !== "undefined" &&
    typeof value.closeStdinAfterSpawn !== "boolean"
  ) {
    return false;
  }

  if ("bootstrapInput" in value && typeof value.bootstrapInput !== "undefined") {
    // Intentionally loose: bootstrap frames are transport-specific and can be
    // text or structured payloads.
    if (!Array.isArray(value.bootstrapInput)) {
      return false;
    }
  }

  return true;
}

function isSupervisorLimits(value: unknown): value is SupervisorLimits {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNumber(value.terminateGraceMs) &&
    value.terminateGraceMs >= 0 &&
    isNumber(value.forceKillGraceMs) &&
    value.forceKillGraceMs >= 0
  );
}

export function isParentToSupervisorMessage(
  value: unknown
): value is ParentToSupervisorMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  if (value.type === "interrupt") {
    return true;
  }

  if (value.type === "terminate") {
    return !("reason" in value) || typeof value.reason === "string";
  }

  if (value.type === "start") {
    return isSpawnSpec(value.spec) && isSupervisorLimits(value.limits);
  }

  return false;
}

export function isSupervisorToParentMessage(
  value: unknown
): value is SupervisorToParentMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  if (value.type === "started") {
    return value.pid === null || isNumber(value.pid);
  }

  if (value.type === "spawn_error") {
    return isString(value.error);
  }

  return false;
}
