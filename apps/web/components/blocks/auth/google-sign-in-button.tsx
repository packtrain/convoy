"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useOauth, useSignInWithGoogle, type OauthFlowError } from "@convex-dev/auth/methods/google/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { getMutationErrorMessage } from "@/lib/errors";

const GOOGLE_FAILED = "Could not sign in with Google. Try again.";

const FLOW_ERRORS: Record<Exclude<OauthFlowError["error"], "OTHER_ERROR">, string> = {
  ACCESS_DENIED: "Sign-in was cancelled.",
  EXPIRED: "Sign-in took too long. Try again.",
  INVALID_FLOW: "Sign-in didn't finish. Start again from this page.",
};

function flowErrorMessage(flowError: OauthFlowError): string {
  return flowError.error === "OTHER_ERROR"
    ? getMutationErrorMessage(flowError.cause, GOOGLE_FAILED)
    : FLOW_ERRORS[flowError.error];
}

/** "Continue with Google" and an "or" divider, only on a deployment with Google credentials. */
export function GoogleSignInButton() {
  const settings = useQuery(api.auth.getSettings, {});
  const { signIn } = useSignInWithGoogle(api.auth);
  // The flow finishes on the page it started from, so a failure after Google's redirect shows here.
  const { flowError } = useOauth();
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  if (!settings?.googleEnabled) return null;

  const start = async () => {
    setStartError(null);
    setPending(true);
    // On success the page has already left for Google.
    const result = await signIn();
    if (result.status === "error") {
      setStartError(getMutationErrorMessage(result.userError.cause, GOOGLE_FAILED));
      setPending(false);
    }
  };
  const error = startError ?? (flowError && flowErrorMessage(flowError));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => void start()}>
          <GoogleLogo />
          Continue with Google
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">or</FieldSeparator>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}
