import { parseAvailableCli } from "../../cli/lib/runtimes/registry";
import type { AvailableCli } from "../contracts/validators";
import { jsonError, jsonResponse } from "./responses";

export type RegisterPathInput = {
  path: string;
  label?: string;
  gitRemoteUrl?: string;
};

export type RegisterBody = {
  instanceId?: string;
  projectId?: string;
  hostname?: string;
  name?: string;
  profileKey?: string;
  paths?: RegisterPathInput[];
  availableClis?: unknown[];
  appVersion?: string;
  supportsPartialStreaming?: boolean;
  supportsInteractiveApprovals?: boolean;
  supportsSteering?: boolean;
  steeringCliTypes?: string[];
  force?: boolean;
};

export type ValidatedRegisterScalars = {
  instanceId: string;
  projectId: string;
  hostname?: string;
  name?: string;
  profileKey?: string;
  appVersion?: string;
  supportsPartialStreaming?: boolean;
  supportsInteractiveApprovals?: boolean;
  supportsSteering?: boolean;
  steeringCliTypes?: string[];
  force?: boolean;
};

export function validateRegisterScalars(
  body: RegisterBody
): { success: true; value: ValidatedRegisterScalars } | { success: false; response: Response } {
  if (!body.instanceId || typeof body.instanceId !== "string") {
    return { success: false, response: jsonError("instanceId is required", 400) };
  }
  if (!body.projectId || typeof body.projectId !== "string") {
    return { success: false, response: jsonError("projectId is required", 400) };
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    return { success: false, response: jsonError("name must be a string", 400) };
  }
  if (body.hostname !== undefined && typeof body.hostname !== "string") {
    return { success: false, response: jsonError("hostname must be a string", 400) };
  }
  if (body.profileKey !== undefined && typeof body.profileKey !== "string") {
    return { success: false, response: jsonError("profileKey must be a string", 400) };
  }
  if (body.appVersion !== undefined && typeof body.appVersion !== "string") {
    return { success: false, response: jsonError("appVersion must be a string", 400) };
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return { success: false, response: jsonError("force must be a boolean", 400) };
  }
  if (
    body.supportsPartialStreaming !== undefined &&
    typeof body.supportsPartialStreaming !== "boolean"
  ) {
    return {
      success: false,
      response: jsonError("supportsPartialStreaming must be a boolean", 400),
    };
  }
  if (
    body.supportsInteractiveApprovals !== undefined &&
    typeof body.supportsInteractiveApprovals !== "boolean"
  ) {
    return {
      success: false,
      response: jsonError("supportsInteractiveApprovals must be a boolean", 400),
    };
  }
  if (body.supportsSteering !== undefined && typeof body.supportsSteering !== "boolean") {
    return {
      success: false,
      response: jsonError("supportsSteering must be a boolean", 400),
    };
  }
  if (
    body.steeringCliTypes !== undefined &&
    (!Array.isArray(body.steeringCliTypes) ||
      body.steeringCliTypes.some((entry) => typeof entry !== "string"))
  ) {
    return {
      success: false,
      response: jsonError("steeringCliTypes must be an array of strings", 400),
    };
  }

  return {
    success: true,
    value: {
      instanceId: body.instanceId,
      projectId: body.projectId,
      hostname: body.hostname,
      name: body.name,
      profileKey: body.profileKey,
      appVersion: body.appVersion,
      supportsPartialStreaming: body.supportsPartialStreaming,
      supportsInteractiveApprovals: body.supportsInteractiveApprovals,
      supportsSteering: body.supportsSteering,
      steeringCliTypes: body.steeringCliTypes,
      force: body.force,
    },
  };
}

// Oldest @useconvoy/cli allowed to register. Bump when a backend API change
// breaks older CLIs — see docs/specs/cli-minimum-version.md.
export const MIN_SUPPORTED_CLI_VERSION = "0.55.0";

// Same major/minor/patch semantics as the CLI's compareVersions
// (apps/cli/src/agent/sdk/versioning/provider-version.ts): first x.y.z in the
// string, missing or malformed counts as 0.0.0.
function parseVersion(raw: string | undefined): number[] {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

/** Rejects CLIs older than minVersion with 426 — see docs/specs/cli-minimum-version.md. */
export function checkMinSupportedCliVersion(
  appVersion: string | undefined,
  minVersion: string
): { success: true } | { success: false; response: Response } {
  const actual = parseVersion(appVersion);
  const min = parseVersion(minVersion);
  const diff = actual.map((n, i) => n - min[i]).find((d) => d !== 0) ?? 0;
  if (diff >= 0) {
    return { success: true };
  }
  return {
    success: false,
    response: jsonResponse(
      {
        error: `Convoy CLI ${appVersion ?? "(version unknown)"} is older than the minimum supported version ${minVersion}. Update: npm install -g @useconvoy/cli@latest`,
        code: "CLI_UPDATE_REQUIRED",
        minVersion,
      },
      426
    ),
  };
}

export function parseRegisterPaths(
  value: RegisterBody["paths"]
): { success: true; value: RegisterPathInput[] | undefined } | { success: false; response: Response } {
  if (value === undefined) {
    return { success: true, value: undefined };
  }

  if (!Array.isArray(value)) {
    return { success: false, response: jsonError("paths must be an array", 400) };
  }

  const parsed: RegisterPathInput[] = [];
  for (const pathValue of value) {
    if (!pathValue || typeof pathValue !== "object") {
      return {
        success: false,
        response: jsonError("Each path must be an object with a path field", 400),
      };
    }

    const pathStr = (pathValue as { path?: unknown }).path;
    if (typeof pathStr !== "string" || pathStr.length < 1) {
      return {
        success: false,
        response: jsonError("Each path must have a non-empty path string", 400),
      };
    }

    const label = (pathValue as { label?: unknown }).label;
    if (label !== undefined && typeof label !== "string") {
      return { success: false, response: jsonError("Path label must be a string", 400) };
    }

    const gitRemoteUrl = (pathValue as { gitRemoteUrl?: unknown }).gitRemoteUrl;
    if (gitRemoteUrl !== undefined && typeof gitRemoteUrl !== "string") {
      return {
        success: false,
        response: jsonError("Path gitRemoteUrl must be a string", 400),
      };
    }

    parsed.push({ path: pathStr, label, gitRemoteUrl });
  }

  return { success: true, value: parsed };
}

export function parseRegisterAvailableClis(
  value: RegisterBody["availableClis"]
): { success: true; value: AvailableCli[] | undefined } | { success: false; response: Response } {
  if (value === undefined) {
    return { success: true, value: undefined };
  }

  if (!Array.isArray(value)) {
    return {
      success: false,
      response: jsonError("availableClis must be an array", 400),
    };
  }

  const parsed: AvailableCli[] = [];
  for (const cli of value) {
    const parsedCli = parseAvailableCli(cli);
    if (!parsedCli.success) {
      return { success: false, response: jsonError(parsedCli.message, 400) };
    }
    parsed.push(parsedCli.value);
  }

  return { success: true, value: parsed };
}
