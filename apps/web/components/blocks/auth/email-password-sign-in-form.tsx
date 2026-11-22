"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useSignInWithEmailPassword, type SignInResult } from "@convex-dev/auth/methods/email-password/react";
import { api } from "@/convex/_generated/api";
import { AppLink, appRoute, useNavigation } from "@/lib/navigation";
import { AUTH_REDIRECT_PARAM } from "@/lib/routing/auth-redirects";
import { GoogleSignInButton } from "./google-sign-in-button";
import { EmailPasswordForm, type EmailPasswordCredentials } from "./email-password-form";

type SignInErrorCode = Extract<SignInResult, { status: "error" }>["userError"]["error"];

const WRONG_CREDENTIALS = "Wrong email or password.";

const SIGN_IN_ERRORS: Record<SignInErrorCode, string> = {
  USER_NOT_FOUND: WRONG_CREDENTIALS,
  INVALID_CREDENTIALS: WRONG_CREDENTIALS,
  PASSWORD_TOO_SHORT: WRONG_CREDENTIALS,
  PASSWORD_TOO_LONG: WRONG_CREDENTIALS,
  PASSWORD_HAS_SURROUNDING_WHITESPACE: WRONG_CREDENTIALS,
  RATE_LIMITED: "Too many attempts. Try again later.",
  OTHER_ERROR: "Could not sign in. Try again.",
};

/** Convex Auth sign-in. On success the auth page wrapper forwards to /auth/callback. */
export function EmailPasswordSignInForm() {
  const { signIn, pending } = useSignInWithEmailPassword(api.auth);
  const settings = useQuery(api.auth.getSettings, {});
  const [error, setError] = useState<string | null>(null);
  const redirectUrl = new URLSearchParams(useNavigation().location.search).get(AUTH_REDIRECT_PARAM);

  const handleSubmit = async (credentials: EmailPasswordCredentials) => {
    setError(null);
    const result = await signIn(credentials);
    if (result.status === "error") setError(SIGN_IN_ERRORS[result.userError.error]);
  };

  return (
    <EmailPasswordForm
      title="Sign in to Convoy"
      description="Welcome back. Sign in to your account."
      submitLabel="Sign in"
      passwordAutoComplete="current-password"
      passwordLabelAside={
        // Recovery needs a mailbox; see docs/specs/auth-adapters.md#forgotten-password.
        settings?.emailEnabled && (
          <AppLink href={appRoute.authForgotPassword(redirectUrl)} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Forgot password?
          </AppLink>
        )
      }
      otherMethods={<GoogleSignInButton />}
      error={error}
      pending={pending}
      onSubmit={handleSubmit}
      footer={
        <>
          No account?{" "}
          <AppLink href={appRoute.authSignUp(redirectUrl)} className="text-foreground underline underline-offset-4">
            Sign up
          </AppLink>
        </>
      }
    />
  );
}
