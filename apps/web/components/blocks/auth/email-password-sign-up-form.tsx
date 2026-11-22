"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppLink, appRoute, useNavigation } from "@/lib/navigation";
import { AUTH_REDIRECT_PARAM } from "@/lib/routing/auth-redirects";
import { getMutationErrorMessage } from "@/lib/errors";
import { EmailPasswordForm, type EmailPasswordCredentials } from "./email-password-form";

type SignUpResult = FunctionReturnType<typeof api.auth.signUpWithoutEmailVerification>;
type SignUpErrorCode = Extract<SignUpResult, { status: "error" }>["userError"]["error"];

const SIGN_UP_ERRORS: Record<SignUpErrorCode, string> = {
  INVALID_EMAIL: "Enter a valid email address.",
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  RATE_LIMITED: "Too many attempts. Try again later.",
  PASSWORD_TOO_SHORT: `Use at least ${DEFAULT_MIN_PASSWORD_LENGTH} characters.`,
  PASSWORD_TOO_LONG: "This password is too long.",
  PASSWORD_HAS_SURROUNDING_WHITESPACE: "Remove the spaces at the start or end of the password.",
  PASSWORD_TOO_COMMON: "This password is too common. Choose another.",
};
const SIGN_UP_FAILED = "Could not create your account. Try again.";

/**
 * Convex Auth sign-up with verification off: one mutation creates the account and
 * returns a session. See docs/specs/auth-adapters.md.
 */
export function EmailPasswordSignUpForm() {
  const signUp = useMutation(api.auth.signUpWithoutEmailVerification);
  const { setSession } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectUrl = new URLSearchParams(useNavigation().location.search).get(AUTH_REDIRECT_PARAM);

  const handleSubmit = async (credentials: EmailPasswordCredentials) => {
    setError(null);
    setPending(true);
    try {
      const result = await signUp(credentials);
      // On success the auth page wrapper forwards to /auth/callback.
      if (result.status === "complete") await setSession(result.tokens);
      else setError(SIGN_UP_ERRORS[result.userError.error]);
    } catch (err) {
      // A ConvexError carries the deployment's reason, e.g. email sending not configured.
      setError(getMutationErrorMessage(err, SIGN_UP_FAILED));
    } finally {
      setPending(false);
    }
  };

  return (
    <EmailPasswordForm
      title="Create your account"
      description="Fill in the form below to create your account"
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      error={error}
      pending={pending}
      onSubmit={(credentials) => void handleSubmit(credentials)}
      footer={
        <>
          Have an account?{" "}
          <AppLink href={appRoute.authSignIn(redirectUrl)} className="text-foreground underline underline-offset-4">
            Sign in
          </AppLink>
        </>
      }
    />
  );
}
