import { appRoute, href } from "@/lib/navigation";

const DEFAULT_APP_URL = "https://app.convoy.build";

export function getAppUrlBase(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return configuredUrl || DEFAULT_APP_URL;
}

function buildAbsoluteUrl(path: string): string {
  return new URL(path, getAppUrlBase()).toString();
}

export function buildInvitationUrl(token: string): string {
  return buildAbsoluteUrl(`/auth/invite/${token}`);
}

export function buildOrganizationUrl(organizationSlug: string): string {
  return buildAbsoluteUrl(href(appRoute.organization(organizationSlug)));
}

export function buildProjectUrl(
  organizationSlug: string,
  projectAlias: string,
): string {
  return buildAbsoluteUrl(href(appRoute.project(organizationSlug, projectAlias)));
}
