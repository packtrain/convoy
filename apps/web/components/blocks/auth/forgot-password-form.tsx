"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import {
  useStartPasswordRecovery,
  type StartPasswordRecoveryResult,
} from "@convex-dev/auth/methods/email-password/react";
import { api } from "@/convex/_generated/api";
import { Spinner } from "@/components/custom/spinner";
import { getMutationErrorMessage } from "@/lib/errors";
import { AppLink, appRoute, useNavigation } from "@/lib/navigation";
import { AUTH_REDIRECT_PARAM } from "@/lib/routing/auth-redirects";
import { AuthCardHeading, AuthCardPage, EmailPasswordForm, type EmailPasswordCredentials } from "./email-password-form";

type StartErrorCode = Extract<StartPasswordRecoveryResult, { success: false }>["userError"]["error"];

const START_FAILED = "Could not send the link. Try again.";
const START_ERRORS: Record<Exclude<StartErrorCode, "OTHER_ERROR">, string> = {
  INVALID_EMAIL: "Enter a valid email address.",
  EMAIL_NOT_FOUND: "No account uses this email.",
  RATE_LIMITED: "Too many attempts. Try again later.",
};

/** Convex Auth "Forgot password": emails a reset link and keeps its secret in this browser. */
export function ForgotPasswordForm() {
  const settings = useQuery(api.auth.getSettings, {});
  const { startPasswordRecovery, pending } = useStartPasswordRecovery(api.auth);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const redirectUrl = new URLSearchParams(useNavigation().location.search).get(AUTH_REDIRECT_PARAM);

  const handleSubmit = async ({ email }: EmailPasswordCredentials) => {
    setError(null);
    const result = await startPasswordRecovery({ email });
    if (result.success) setSentTo(result.sentTo);
    // A ConvexError carries the deployment's reason, e.g. email sending not configured.
    else if (result.userError.error === "OTHER_ERROR") setError(getMutationErrorMessage(result.userError.cause, START_FAILED));
    else setError(START_ERRORS[result.userError.error]);
  };

  const signInLink = (
    <AppLink href={appRoute.authSignIn(redirectUrl)} className="text-foreground underline underline-offset-4">
      Back to sign in
    </AppLink>
  );

  if (settings === undefined) {
    return (
      <AuthCardPage>
        <Spinner size="large" text="Loading…" />
      </AuthCardPage>
    );
  }
  // Off wins over a sent link: with email off the stand-in sender drops it.
  if (!settings.emailEnabled || sentTo !== null) {
    return (
      <AuthCardPage>
        <div className="flex flex-col gap-6">
          {settings.emailEnabled ? (
            <AuthCardHeading
              title="Check your email"
              description={`We sent a link to ${sentTo}. Open it in this browser within 10 minutes to set a new password.`}
            />
          ) : (
            <AuthCardHeading title="Password reset is off" description="This deployment doesn't send email, so it can't reset passwords." />
          )}
          <p className="text-center text-sm text-muted-foreground">{signInLink}</p>
        </div>
      </AuthCardPage>
    );
  }

  return (
    <EmailPasswordForm
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to set a new one."
      submitLabel="Send link"
      passwordAutoComplete={null}
      error={error}
      pending={pending}
      onSubmit={(credentials) => void handleSubmit(credentials)}
      footer={signInLink}
    />
  );
}
