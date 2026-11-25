import { env } from "../../../_generated/server";
import { getAppUrlBase } from "../../../lib/shared/appUrl";

export const GITHUB_HOST = "github.com";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_WEB_URL = "https://github.com";
export const GITHUB_CALLBACK_PATH = "/integrations/github/callback";

/** Rows per provider page and per scheduled batch. */
export const PAGE_SIZE = 30;

export const MAX_SYNC_ATTEMPTS = 5;

/** Backoff before retry `attempt` (1-based): 30s, 1m, 2m, 4m. */
export function syncRetryDelayMs(attempt: number): number {
  return 30_000 * 2 ** (attempt - 1);
}

// Pull request watch (docs/specs/pull-request-watch.md).
/** Check events in this window become one evaluation: one read and at most one message. */
export const WATCH_EVALUATION_DELAY_MS = 45_000;
/** An evaluation still unfinished this long after its time died; the next event replaces it. */
export const WATCH_EVALUATION_STALE_MS = 5 * 60_000;
/** Watches one PR takes, so an event reaches every one in a transaction. */
export const WATCHES_PER_PULL_REQUEST_MAX = 50;
/** How often the cron looks for idle watches: missed webhooks, base-branch pushes. */
export const WATCH_IDLE_CRON_MINUTES = 1;
/** A watch is idle after this long with no finished evaluation. With the cron's minute and a mergeability recheck, news is read within 10 minutes. */
export const WATCH_IDLE_MS = 8 * 60_000;

export type GithubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

/** The deployment's GitHub App, or null when any credential is missing. */
export function readGithubAppConfig(): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  if (!appId || !slug || !privateKey || !clientId || !clientSecret || !webhookSecret) {
    return null;
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    console.warn("GITHUB_APP_PRIVATE_KEY must be PKCS#8 (BEGIN PRIVATE KEY); see the GitHub integration deployment guide");
    return null;
  }
  return { appId, slug, privateKey, clientId, clientSecret, webhookSecret };
}

export function githubCallbackUrl(): string {
  return `${getAppUrlBase()}${GITHUB_CALLBACK_PATH}`;
}

export function githubInstallUrl(config: GithubAppConfig): string {
  return `${GITHUB_WEB_URL}/apps/${encodeURIComponent(config.slug)}/installations/new`;
}

export function githubAuthorizeUrl(config: GithubAppConfig, state: string): string {
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: githubCallbackUrl(), state });
  return `${GITHUB_WEB_URL}/login/oauth/authorize?${query}`;
}
