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
  if (eventName === "check_suite" || eventName === "check_run" || eventName === "status") {
    return parseChecksEvent(eventName, payload, installationId);
  }
  if (eventName === "pull_request_review" || eventName === "pull_request_review_comment" || eventName === "issue_comment") {
    return parseCommentsEvent(eventName, payload, installationId);
  }
  if (eventName === "installation" || eventName === "installation_repositories") {
    return { provider: "github", github: { kind: "accessChanged", installationId } };
  }
  return null;
}

/** A finished check suite or run, or a commit status, for Pull request watches (docs/specs/pull-request-watch.md). */
function parseChecksEvent(eventName: string, payload: unknown, installationId: number): VerifiedEvent | null {
  const repositoryId = field(field(payload, "repository"), "id");
  const subject = eventName === "status" ? payload : field(payload, eventName);
  const headSha = eventName === "status" ? field(payload, "sha") : field(subject, "head_sha");
  if (eventName !== "status" && field(payload, "action") !== "completed") return null;
  if (typeof repositoryId !== "number" || typeof headSha !== "string") return null;
  const pulls = field(subject, "pull_requests");
  // GitHub lists PRs from any repository with this head; only this repository's are its own.
  const numbers = (Array.isArray(pulls) ? pulls : [])
    .filter((pull) => field(field(field(pull, "base"), "repo"), "id") === repositoryId)
    .map((pull) => field(pull, "number"))
    .filter((number): number is number => typeof number === "number");
  return { provider: "github", github: { kind: "checks", installationId, repositoryId, headSha, numbers } };
}

/** A new review, review comment, or comment on a PR, for Pull request watches; edits and deletes are no news. */
function parseCommentsEvent(eventName: string, payload: unknown, installationId: number): VerifiedEvent | null {
  const repositoryId = field(field(payload, "repository"), "id");
  if (field(payload, "action") !== (eventName === "pull_request_review" ? "submitted" : "created")) return null;
  // An issue_comment's issue is a PR only when it has `pull_request`.
  const subject = eventName === "issue_comment" ? field(payload, "issue") : field(payload, "pull_request");
  if (eventName === "issue_comment" && field(subject, "pull_request") === undefined) return null;
  const number = field(subject, "number");
  return typeof repositoryId === "number" && typeof number === "number"
    ? { provider: "github", github: { kind: "comments", installationId, repositoryId, number } }
    : null;
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
  const eventName = request.headers.get("X-GitHub-Event");
  // Sent to every App when a person revokes its authorization; it has no installation.
  const revokedUserId = field(field(payload, "sender"), "id");
  if (eventName === "github_app_authorization" && field(payload, "action") === "revoked" && typeof revokedUserId === "number") {
    await ctx.runMutation(internal.integrations.github.accounts.markRevoked, { githubUserId: revokedUserId });
    return new Response(null, { status: 202 });
  }
  const event = parseGithubEvent(eventName, payload);
  if (event) {
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.fanOutWebhook, { event });
  }
  return new Response(null, { status: 202 });
}
