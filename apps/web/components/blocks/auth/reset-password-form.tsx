"use client";

import { useEffect, useState } from "react";
import {
  useCompletePasswordRecovery,
  type CompletePasswordRecoveryResult,
  type CompletePasswordRecoveryState,
} from "@convex-dev/auth/methods/email-password/react";
import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import { api } from "@/convex/_generated/api";
import { Spinner } from "@/components/custom/spinner";
import { AppLink, appRoute, targetFromHref, useNavigation } from "@/lib/navigation";
import { buildAuthCallbackPath } from "@/lib/routing/auth-redirects";
import { AuthCardHeading, AuthCardPage, EmailPasswordForm } from "./email-password-form";

type LinkErrorCode = Extract<CompletePasswordRecoveryState, { status: "error" }>["userError"]["error"];
type PasswordErrorCode = Exclude<
  Extract<CompletePasswordRecoveryResult, { status: "error" }>["userError"]["error"],
  LinkErrorCode
>;

const EXPIRED_LINK = "This link has expired or was already used. Ask for a new one.";
const LINK_ERRORS: Record<LinkErrorCode, string> = {
  MISSING_SECRET: "Open the link in the browser where you asked for it.",
  INVALID_CHALLENGE: EXPIRED_LINK,
  INCORRECT_CODE: EXPIRED_LINK,
};
const PASSWORD_ERRORS: Record<PasswordErrorCode, string> = {
  PASSWORD_TOO_SHORT: `Use at least ${DEFAULT_MIN_PASSWORD_LENGTH} characters.`,
  PASSWORD_TOO_LONG: "This password is too long.",
  PASSWORD_HAS_SURROUNDING_WHITESPACE: "Remove the spaces at the start or end of the password.",
  PASSWORD_TOO_COMMON: "This password is too common. Choose another.",
  OTHER_ERROR: "Could not set the password. Try again.",
};

/** Landing page of the emailed reset link: sets the new password, which signs out every other session, then onboards. */
export function ResetPasswordForm() {
  const navigation = useNavigation();
  const emailCode = new URLSearchParams(navigation.location.search).get("code") ?? "";
  const state = useCompletePasswordRecovery(api.auth, { emailCode });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "complete") navigation.replace(targetFromHref(buildAuthCallbackPath(null)));
  }, [state.status, navigation]);

  if (state.status === "error") {
    return (
      <AuthCardPage>
        <div className="flex flex-col gap-6">
          <AuthCardHeading title="Password not reset" />
          <p role="alert" className="text-center text-sm text-destructive">
            {LINK_ERRORS[state.userError.error]}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            <AppLink href={appRoute.authForgotPassword()} className="text-foreground underline underline-offset-4">
              Get a new link
            </AppLink>
          </p>
        </div>
      </AuthCardPage>
    );
  }
  if (state.status !== "ready") {
    return (
      <AuthCardPage>
        <Spinner size="large" text={state.status === "complete" ? "Signing you in…" : "Checking the link…"} />
      </AuthCardPage>
    );
  }

  const { completePasswordRecovery, pending } = state;
  const handleSubmit = async (newPassword: string) => {
    setError(null);
    const result = await completePasswordRecovery({ newPassword });
    // A link error moves the state to "error" on its own.
    if (result.status === "error" && result.userError.error in PASSWORD_ERRORS) {
      setError(PASSWORD_ERRORS[result.userError.error as PasswordErrorCode]);
    }
  };

  return (
    <EmailPasswordForm
      title="Set a new password"
      description="Your other sessions are signed out once it's set."
      submitLabel="Set password and sign in"
      askEmail={false}
      passwordAutoComplete="new-password"
      error={error}
      pending={pending}
      onSubmit={({ password }) => void handleSubmit(password)}
    />
  );
}
