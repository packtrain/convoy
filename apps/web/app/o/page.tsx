"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RouteErrorState } from "@/components/blocks/auth/route-error-state";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { appRoute, targetFromHref, useNavigation } from "@/lib/navigation";
import { useAppAuthReadiness } from "@/lib/auth/use-app-auth-readiness";
import { getLastOrganizationSlug } from "@/lib/routing/last-org-storage";

export default function OrgBasePage() {
  const navigation = useNavigation();
  const hasRedirected = useRef(false);
  const { status: authStatus } = useAppAuthReadiness();
  const organizations = useQuery(api.organizations.core.listForUser, authStatus === "authenticated" ? {} : "skip");

  useEffect(() => {
    if (authStatus !== "authenticated" || organizations === undefined || hasRedirected.current) {
      return;
    }

    hasRedirected.current = true;

    // Try the remembered organization first
    const lastOrgSlug = getLastOrganizationSlug();
    if (lastOrgSlug) {
      // Verify the slug still exists in user's orgs
      const orgExists = organizations.some((org) => org.slug === lastOrgSlug);
      if (orgExists) {
        navigation.replace(appRoute.organization(lastOrgSlug));
        return;
      }
    }

    // Fallback to first organization (personal org should be first)
    if (organizations.length > 0) {
      navigation.replace(appRoute.organization(organizations[0].slug));
      return;
    }

    // No organizations means onboarding never ran (e.g. the Clerk
    // redirect skipped /auth/callback) — send the user through it.
    navigation.replace(targetFromHref("/auth/callback"));
  }, [authStatus, navigation, organizations]);

  if (authStatus === "signed-out" || authStatus === "timed-out") {
    return <RouteErrorState variant="auth" />;
  }

  return (
    <Centered variant="screen">
      <Spinner size="large" text="Loading…" />
    </Centered>
  );
}
