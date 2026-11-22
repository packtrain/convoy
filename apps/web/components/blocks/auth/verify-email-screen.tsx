"use client";

import { useEffect, useRef } from "react";
import {
  useCompleteSignUpWithEmailPassword,
  type CompleteSignUpState,
} from "@convex-dev/auth/methods/email-password/react";
import { api } from "@/convex/_generated/api";
import { Spinner } from "@/components/custom/spinner";
import { AppLink, appRoute, targetFromHref, useNavigation } from "@/lib/navigation";
import { buildAuthCallbackPath, readSignUpRedirect, takeSignUpRedirect } from "@/lib/routing/auth-redirects";
import { AuthCardHeading, AuthCardPage } from "./email-password-form";

type VerifyErrorCode = Extract<CompleteSignUpState, { status: "error" }>["userError"]["error"];

const EXPIRED_LINK = "This link has expired or was already used. Sign up again to get a new one.";
const VERIFY_ERRORS: Record<VerifyErrorCode, string> = {
  MISSING_SECRET: "Open the link in the browser where you signed up.",
  INVALID_CHALLENGE: EXPIRED_LINK,
  INCORRECT_CODE: EXPIRED_LINK,
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  OTHER_ERROR: "Could not verify your email. Try again.",
};

/** Landing page of the emailed sign-up link: completes the sign-up, then onboards via /auth/callback. */
export function VerifyEmailScreen() {
  const navigation = useNavigation();
  const emailCode = new URLSearchParams(navigation.location.search).get("code") ?? "";
  const state = useCompleteSignUpWithEmailPassword(api.auth, { emailCode });

  // Once: the stored redirect is taken on the first run.
  const navigated = useRef(false);
  useEffect(() => {
    if (state.status !== "complete" || navigated.current) return;
    navigated.current = true;
    navigation.replace(targetFromHref(buildAuthCallbackPath(takeSignUpRedirect())));
  }, [state.status, navigation]);

  return (
    <AuthCardPage>
      {state.status === "error" ? (
        <div className="flex flex-col gap-6">
          <AuthCardHeading title="Email not verified" />
          <p role="alert" className="text-center text-sm text-destructive">
            {VERIFY_ERRORS[state.userError.error]}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            {/* Keeps the redirect, so a retry from an invitation still ends on it. */}
            <AppLink href={appRoute.authSignUp(readSignUpRedirect())} className="text-foreground underline underline-offset-4">
              Back to sign up
            </AppLink>
          </p>
        </div>
      ) : (
        <Spinner size="large" text="Verifying your email…" />
      )}
    </AuthCardPage>
  );
}
