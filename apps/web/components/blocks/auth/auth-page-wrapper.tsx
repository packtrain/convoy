"use client";

import { useEffect, useMemo, ReactNode } from "react";
import { useAppAuth } from "@/lib/auth/hooks";
import {
  AUTH_REDIRECT_PARAM,
  sanitizeAuthRedirectUrl,
} from "@/lib/routing/auth-redirects";
import {
  targetFromHref,
  useNavigation,
} from "@/lib/navigation";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";

interface AuthPageWrapperProps {
  children: ReactNode;
}

export function AuthPageWrapper({ children }: AuthPageWrapperProps) {
  const { isLoaded, isSignedIn } = useAppAuth();
  const navigation = useNavigation();
  const searchParams = useMemo(
    () => new URLSearchParams(navigation.location.search),
    [navigation.location.search]
  );

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      const redirectUrl =
        sanitizeAuthRedirectUrl(
          searchParams.get(AUTH_REDIRECT_PARAM),
          window.location.origin
        ) || "/auth/callback";
      navigation.replace(targetFromHref(redirectUrl));
    }
  }, [isLoaded, isSignedIn, navigation, searchParams]);

  // Show loading while checking auth or redirecting
  if (!isLoaded || isSignedIn) {
    return (
      <Centered variant="screen">
        <Spinner size="large" text="Loading…" />
      </Centered>
    );
  }

  return (
    <Centered variant="screen">
      {children}
    </Centered>
  );
}
