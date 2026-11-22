"use client";

import { useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { useAuthActions } from "@convex-dev/auth/react";
import { useSignUpWithEmailPassword } from "@convex-dev/auth/methods/email-password/react";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AppLink, appRoute, useNavigation } from "@/lib/navigation";
import { AUTH_REDIRECT_PARAM, rememberSignUpRedirect } from "@/lib/routing/auth-redirects";
import { getMutationErrorMessage } from "@/lib/errors";
import { AuthCardHeading, AuthCardPage, EmailPasswordForm, type EmailPasswordCredentials } from "./email-password-form";

type SignUpResult = FunctionReturnType<typeof api.auth.signUpWithoutEmailVerification>;
type SignUpErrorCode = Exclude<
  Extract<SignUpResult, { status: "error" }>["userError"]["error"],
  "EMAIL_VERIFICATION_REQUIRED"
>;

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

/** Runs a session-minting mutation through the package's auth proxy route, which keeps the refresh token in an httpOnly cookie. */
function signUpThroughAuthProxy(credentials: EmailPasswordCredentials): Promise<SignUpResult> {
  // The route path and `?path=` suffix are what the package's own sign-in client uses.
  const proxy = new ConvexHttpClient("/auth/signin?path=", { skipConvexDeploymentUrlCheck: true });
  return proxy.mutation(api.auth.signUpWithoutEmailVerification, credentials);
}

/**
 * Convex Auth sign-up. With verification off one mutation returns a session; with it
 * required the package emails a link and keeps its secret here. See docs/specs/auth-adapters.md.
 */
export function EmailPasswordSignUpForm() {
  const { signUp: startEmailedSignUp } = useSignUpWithEmailPassword(api.auth);
  const { setSession } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const redirectUrl = new URLSearchParams(useNavigation().location.search).get(AUTH_REDIRECT_PARAM);

  const startWithEmail = async (credentials: EmailPasswordCredentials) => {
    const started = await startEmailedSignUp(credentials);
    if (started.success) {
      rememberSignUpRedirect(redirectUrl);
      setSentTo(credentials.email);
    } else if (started.userError.error === "OTHER_ERROR") {
      setError(getMutationErrorMessage(started.userError.cause, SIGN_UP_FAILED));
    } else {
      setError(SIGN_UP_ERRORS[started.userError.error]);
    }
  };

  const handleSubmit = async (credentials: EmailPasswordCredentials) => {
    setError(null);
    setPending(true);
    try {
      const result = await signUpThroughAuthProxy(credentials);
      // On success the auth page wrapper forwards to /auth/callback.
      if (result.status === "complete") await setSession(result.tokens);
      else if (result.userError.error === "EMAIL_VERIFICATION_REQUIRED") await startWithEmail(credentials);
      else setError(SIGN_UP_ERRORS[result.userError.error]);
    } catch (err) {
      // A ConvexError carries the deployment's reason, e.g. email sending not configured.
      setError(getMutationErrorMessage(err, SIGN_UP_FAILED));
    } finally {
      setPending(false);
    }
  };

  const signInLink = (
    <AppLink href={appRoute.authSignIn(redirectUrl)} className="text-foreground underline underline-offset-4">
      Sign in
    </AppLink>
  );

  if (sentTo !== null) {
    return (
      <AuthCardPage>
        <div className="flex flex-col gap-6">
          <AuthCardHeading
            title="Check your email"
            description={`We sent a link to ${sentTo}. Open it in this browser to finish creating your account.`}
          />
          <p className="text-center text-sm text-muted-foreground">
            No email?{" "}
            <button type="button" className="text-foreground underline underline-offset-4" onClick={() => setSentTo(null)}>
              Sign up again
            </button>
          </p>
        </div>
      </AuthCardPage>
    );
  }

  return (
    <EmailPasswordForm
      title="Create your account"
      description="Fill in the form below to create your account"
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      error={error}
      pending={pending}
      onSubmit={(credentials) => void handleSubmit(credentials)}
      footer={<>Have an account? {signInLink}</>}
    />
  );
}
