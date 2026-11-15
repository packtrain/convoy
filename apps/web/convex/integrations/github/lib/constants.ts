import { env } from "../../../_generated/server";
import { isLocalDemoDeployment } from "../../../lib/access/localDemo";
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

export type GithubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

/**
 * The deployment's GitHub App, or null when any credential is missing.
 * Local-demo deployments have no real identity to bind setup to.
 */
export function readGithubAppConfig(): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  if (isLocalDemoDeployment() || !appId || !slug || !privateKey || !clientId || !clientSecret || !webhookSecret) {
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
