"use client";

import { useMemo } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthPageWrapper } from "@/components/blocks/auth/auth-page-wrapper";
import {
  AUTH_REDIRECT_PARAM,
  buildAuthCallbackPath,
} from "@/lib/routing/auth-redirects";
import { useNavigation } from "@/lib/navigation";

export default function SignInPage() {
  const navigation = useNavigation();
  // Clerk prefers the redirect_url query param over fallbackRedirectUrl,
  // which would skip /auth/callback (and user onboarding). Force the
  // redirect through the callback and let it forward to the destination.
  const forceRedirectUrl = useMemo(() => {
    const params = new URLSearchParams(navigation.location.search);
    return buildAuthCallbackPath(params.get(AUTH_REDIRECT_PARAM));
  }, [navigation.location.search]);

  return (
    <AuthPageWrapper>
      <SignIn forceRedirectUrl={forceRedirectUrl} signUpUrl="/auth/sign-up" />
    </AuthPageWrapper>
  );
}
