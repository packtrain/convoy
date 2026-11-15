import chalk from "chalk";
import ora from "ora";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { toConvexSiteUrl } from "./url.js";

/**
 * Browser-approve login flow (OS-1137): start a challenge, print the approve
 * link plus a backup device code, open the browser when one is available,
 * and poll until the login is approved. The verifier never leaves this
 * process except inside the final poll; the server only ever stores its hash.
 * See docs/specs/cli-browser-login.md.
 */

const POLL_INTERVAL_MS = 2_000;
const HTTP_TIMEOUT_MS = 15_000;
/** Server TTL is 10 min; cap locally so a hostile expiresAt can't run forever. */
const MAX_WAIT_MS = 15 * 60 * 1000;

export interface StartResponse {
  challengeId: string;
  userCode: string;
  loginUrl: string;
  deviceUrl: string;
  expiresAt: number;
}

export type PollResponse =
  | { status: "pending" }
  | { status: "approved"; apiKey: string; email: string }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "not_found" };

/** Only http(s) URLs may be printed or handed to the OS opener. */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Boundary validation: server responses are untrusted input. */
export function parseStartResponse(data: unknown): StartResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.challengeId !== "string" || !record.challengeId) return null;
  if (typeof record.userCode !== "string" || !record.userCode) return null;
  if (!isOpenableUrl(record.loginUrl) || !isOpenableUrl(record.deviceUrl)) return null;
  if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt)) return null;
  return {
    challengeId: record.challengeId,
    userCode: record.userCode,
    loginUrl: record.loginUrl,
    deviceUrl: record.deviceUrl,
    expiresAt: record.expiresAt,
  };
}

export function parsePollResponse(data: unknown): PollResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  switch (record.status) {
    case "pending":
    case "denied":
    case "expired":
    case "not_found":
      return { status: record.status };
    case "approved":
      if (typeof record.apiKey !== "string" || !record.apiKey) return null;
      if (typeof record.email !== "string") return null;
      return { status: "approved", apiKey: record.apiKey, email: record.email };
    default:
      return null;
  }
}

/** The login could not even start (bad URL / unreachable host). Recoverable: callers may re-prompt for the URL. */
export class LoginStartError extends Error {}

/** HTTP failure that carries the status code so callers can classify it. */
class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error
          : `Request failed (${response.status})`;
      throw new HttpStatusError(message, response.status);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** Transient (network, timeout, 5xx, 429) failures are retried while polling. */
function isTransientError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status >= 500 || error.status === 429;
  }
  // AbortError, fetch network errors, JSON hiccups — all worth retrying.
  return true;
}

/**
 * Best-effort: open a URL in the host browser; silently no-ops when headless.
 * The URL is validated as http(s) and never passed through a shell — on
 * Windows this uses rundll32 instead of `cmd /c start` so response data can
 * never reach a command interpreter.
 */
export function tryOpenBrowser(url: string): void {
  if (!isOpenableUrl(url)) return;
  // Canonical percent-encoded form: even without a shell, never hand raw
  // response bytes to another program.
  const safeUrl = new URL(url).href;

  const [command, args] =
    process.platform === "darwin"
      ? ["open", [safeUrl]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", safeUrl]]
        : ["xdg-open", [safeUrl]];

  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => {
      // No browser available (devcontainer/headless) — the printed link + code cover it.
    });
    child.unref();
  } catch {
    // Same: never hard-fail on browser open.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the full browser login against a Convex deployment URL.
 * Returns the freshly minted API key (never persisted by the server).
 */
export async function runBrowserLogin(convexUrl: string): Promise<{ apiKey: string; email: string }> {
  const httpBaseUrl = toConvexSiteUrl(convexUrl);

  const verifier = crypto.randomBytes(32).toString("hex");
  const verifierHash = crypto.createHash("sha256").update(verifier).digest("hex");

  let start: StartResponse;
  try {
    const raw = await postJson(`${httpBaseUrl}/api/cli/login/start`, {
      verifierHash,
      hostname: os.hostname(),
    });
    const parsed = parseStartResponse(raw);
    if (!parsed) {
      throw new Error("Server returned an unexpected login response");
    }
    start = parsed;
  } catch (error) {
    // Recoverable: nothing happened yet, so let the caller re-prompt for the URL.
    throw new LoginStartError(error instanceof Error ? error.message : String(error));
  }

  console.log(chalk.bold("\nOpening browser to authorize this device") + chalk.dim(` (host: ${os.hostname()})`));
  console.log();
  console.log(`  1. Open:  ${chalk.cyan(start.loginUrl)}`);
  console.log(chalk.dim("     (opened automatically if a browser is available)"));
  console.log();
  console.log(`  2. Or go to ${chalk.cyan(start.deviceUrl)} and enter code:`);
  console.log();
  console.log(`         ${chalk.bold(start.userCode)}`);
  console.log();

  tryOpenBrowser(start.loginUrl);

  const spinner = ora("Waiting for approval...").start();
  const deadline = Math.min(start.expiresAt, Date.now() + MAX_WAIT_MS);

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let result: PollResponse;
    try {
      const raw = await postJson(`${httpBaseUrl}/api/cli/login/poll`, {
        challengeId: start.challengeId,
        verifier,
      });
      const parsed = parsePollResponse(raw);
      if (!parsed) continue; // malformed payload: keep polling until expiry
      result = parsed;
    } catch (error) {
      if (isTransientError(error)) continue; // one blip must not kill a 10-min flow
      spinner.fail("Login failed");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }

    if (result.status === "pending") continue;

    if (result.status === "approved") {
      spinner.succeed(`Logged in as ${result.email}`);
      return { apiKey: result.apiKey, email: result.email };
    }

    if (result.status === "denied") {
      spinner.fail("Login was denied in the browser.");
      process.exit(1);
    }

    // expired / not_found
    break;
  }

  spinner.fail("Login request expired. Run the command again.");
  process.exit(1);
}
