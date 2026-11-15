import { parsePositiveInteger } from "./numbers";

export interface AppVersionInfo {
  buildId: string;
  buildTime: string | null;
  gitRef: string | null;
  vercelEnvironment: string | null;
}

export interface AppVersionResponse {
  frontend: AppVersionInfo;
}

export const DEFAULT_APP_VERSION_POLL_INTERVAL_MS = 2 * 60 * 1000;

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

export function getFrontendAppVersion(): AppVersionInfo {
  return {
    buildId: process.env.NEXT_PUBLIC_APP_BUILD_ID ?? "development",
    buildTime: nonEmpty(process.env.NEXT_PUBLIC_APP_BUILD_TIME),
    gitRef: nonEmpty(process.env.NEXT_PUBLIC_APP_GIT_REF),
    vercelEnvironment: nonEmpty(process.env.NEXT_PUBLIC_APP_VERCEL_ENV),
  };
}

export function getAppVersionPollIntervalMs(): number {
  return (
    parsePositiveInteger(process.env.NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS) ??
    DEFAULT_APP_VERSION_POLL_INTERVAL_MS
  );
}

export function isAppVersionResponse(value: unknown): value is AppVersionResponse {
  if (!value || typeof value !== "object") return false;
  const frontend = (value as { frontend?: unknown }).frontend;
  return (
    !!frontend &&
    typeof frontend === "object" &&
    typeof (frontend as { buildId?: unknown }).buildId === "string"
  );
}
