import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { readGithubAppConfig } from "./lib/constants";
import type { VerifiedEvent } from "./lib/validators";

// POST /api/integrations/github/webhook (docs/specs/github-integration.md).
// The scheduled fan-out job is the durable receipt: GitHub gets 202 only
// after it is scheduled. Events are refresh signals, never applied as data.

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Reduce a verified payload to routing data; null for events this slice ignores. */
export function parseGithubEvent(eventName: string | null, payload: unknown): VerifiedEvent | null {
  const installationId = field(field(payload, "installation"), "id");
  if (typeof installationId !== "number") {
    return null;
  }
  if (eventName === "pull_request") {
    const repositoryId = field(field(payload, "repository"), "id");
    const number = field(field(payload, "pull_request"), "number");
    return typeof repositoryId === "number" && typeof number === "number"
      ? { provider: "github", github: { kind: "pullRequest", installationId, repositoryId, number } }
      : null;
  }
  if (eventName === "installation" || eventName === "installation_repositories") {
    return { provider: "github", github: { kind: "accessChanged", installationId } };
  }
  return null;
}

export async function handleGithubWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
  const config = readGithubAppConfig();
  if (!config) {
    return new Response("GitHub integration is not configured", { status: 404 });
  }
  const body = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256") ?? "";
  if (!constantTimeEqual(signature, `sha256=${await hmacSha256Hex(config.webhookSecret, body)}`)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const event = parseGithubEvent(request.headers.get("X-GitHub-Event"), payload);
  if (event) {
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.fanOutWebhook, { event });
  }
  return new Response(null, { status: 202 });
}
