import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAppUrlBase } from "../lib/shared/appUrl";
import { jsonError, jsonResponse } from "../lib/http/responses";

/**
 * HTTP layer for the CLI browser-login flow. Both endpoints are
 * unauthenticated by design (the CLI has no key yet); everything sensitive
 * is gated by the CLI-held verifier inside `cli/login.poll`.
 */

type StartBody = { verifierHash: string; hostname?: string };
type PollBody = { challengeId: string; verifier: string };

function parseStartBody(body: unknown): StartBody | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.verifierHash !== "string") return null;
  if (record.hostname !== undefined && typeof record.hostname !== "string") return null;
  return { verifierHash: record.verifierHash, hostname: record.hostname };
}

function parsePollBody(body: unknown): PollBody | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.challengeId !== "string" || typeof record.verifier !== "string") return null;
  return { challengeId: record.challengeId, verifier: record.verifier };
}

async function readJsonBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function convexErrorMessage(error: unknown): string | null {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : "Request failed";
  }
  return null;
}

export async function handleCliLoginStart(ctx: ActionCtx, request: Request): Promise<Response> {
  const body = parseStartBody(await readJsonBody(request));
  if (!body) {
    return jsonError("verifierHash (string) is required", 400);
  }

  try {
    const result = await ctx.runMutation(internal.cli.login.start, {
      verifierHash: body.verifierHash,
      hostname: body.hostname,
    });

    const appUrl = getAppUrlBase();
    return jsonResponse({
      challengeId: result.challengeId,
      userCode: result.userCode,
      loginUrl: `${appUrl}/cli-login?challenge=${encodeURIComponent(result.challengeId)}`,
      deviceUrl: `${appUrl}/device`,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    const message = convexErrorMessage(error);
    if (message) return jsonError(message, 400);
    throw error;
  }
}

export async function handleCliLoginPoll(ctx: ActionCtx, request: Request): Promise<Response> {
  const body = parsePollBody(await readJsonBody(request));
  if (!body) {
    return jsonError("challengeId and verifier (strings) are required", 400);
  }

  try {
    const result = await ctx.runMutation(internal.cli.login.poll, {
      challengeId: body.challengeId,
      verifier: body.verifier,
    });
    return jsonResponse(result);
  } catch (error) {
    // e.g. active-key limit reached while minting — surface to the CLI.
    const message = convexErrorMessage(error);
    if (message) return jsonError(message, 400);
    throw error;
  }
}
