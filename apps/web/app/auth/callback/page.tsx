"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { RouteErrorState } from "@/components/blocks/auth/route-error-state";
import { useAppAuthReadiness } from "@/lib/auth/use-app-auth-readiness";
import { AUTH_REDIRECT_PARAM, buildAuthPathWithRedirect, sanitizeAuthRedirectUrl } from "@/lib/routing/auth-redirects";
import { appRoute, targetFromHref, useNavigation } from "@/lib/navigation";
import { USER_ERROR_CODES } from "@/convex/users/errors";

type OnboardingFailure = {
  error: Error;
  variant: "auth" | "generic";
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to set up your account");
}

function isAuthenticationOnboardingError(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;

  const data: unknown = error.data;
  return typeof data === "object" && data !== null && "code" in data && data.code === USER_ERROR_CODES.AUTH_NOT_AUTHENTICATED;
}

function AuthCallbackContent() {
  const { status: authStatus } = useAppAuthReadiness();
  const onboard = useMutation(api.users.core.onboard);
  const navigation = useNavigation();
  const [onboardingFailure, setOnboardingFailure] = useState<OnboardingFailure | null>(null);
  const searchParams = useMemo(() => new URLSearchParams(navigation.location.search), [navigation.location.search]);
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (authStatus === "loading" || authStatus === "timed-out" || hasProcessed.current) {
      return;
    }

    if (authStatus === "signed-out") {
      navigation.replace(
        targetFromHref(buildAuthPathWithRedirect(appRoute.authSignIn().pathname, searchParams.get(AUTH_REDIRECT_PARAM), window.location.origin))
      );
      return;
    }

    hasProcessed.current = true;

    onboard()
      .then((result) => {
        const redirectUrl = sanitizeAuthRedirectUrl(searchParams.get(AUTH_REDIRECT_PARAM), window.location.origin);
        if (redirectUrl) {
          navigation.replace(targetFromHref(redirectUrl));
        } else {
          navigation.replace(appRoute.organization(result.organizationSlug));
        }
      })
      .catch((error) => {
        console.error("Failed to onboard user:", error);
        setOnboardingFailure({
          error: toError(error),
          variant: isAuthenticationOnboardingError(error) ? "auth" : "generic",
        });
      });
  }, [authStatus, navigation, onboard, searchParams]);

  if (onboardingFailure) {
    return <RouteErrorState error={onboardingFailure.error} variant={onboardingFailure.variant} />;
  }

  if (authStatus === "timed-out") {
    return <RouteErrorState variant="auth" />;
  }

  return (
    <Centered variant="screen">
      <Spinner size="large" text="Setting up your account" />
    </Centered>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <Centered variant="screen">
          <Spinner size="large" text="Loading…" />
        </Centered>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
