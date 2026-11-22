"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ConvexProvider, useMutation, type ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { getErrorMessage } from "@/lib/errors";
import type { AppAuthState, AppSignOut, AuthAdapter } from "../hooks";
import { useConvexUser, useConvexUpdateProfileName } from "./convex-user";

/**
 * Local-demo mode (OS-1230): no Clerk. Anonymous Convex calls resolve to the
 * demo user server-side; this gate bootstraps that user (idempotently) before
 * rendering the app so first-load queries see an onboarded workspace.
 */
function LocalDemoGate({ children }: { children: ReactNode }) {
  const onboard = useMutation(api.users.core.onboardLocalDemo);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    onboard({})
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(err, "Failed to start local demo"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onboard]);

  if (error) {
    return (
      <Centered variant="screen">
        <p className="text-sm text-destructive">{error}</p>
      </Centered>
    );
  }

  if (!ready) {
    return (
      <Centered variant="screen">
        <Spinner size="large" text="Starting local demo" />
      </Centered>
    );
  }

  return <>{children}</>;
}

function LocalDemoProvider({ client, children }: { client: ConvexReactClient; children: ReactNode }) {
  return (
    <ConvexProvider client={client}>
      <LocalDemoGate>{children}</LocalDemoGate>
    </ConvexProvider>
  );
}

// Stable references — consumers may use these objects as effect/memo deps.
const LOCAL_DEMO_AUTH_STATE: AppAuthState = {
  isLoaded: true,
  isSignedIn: true,
  userId: "local-demo",
};
const LOCAL_DEMO_CONVEX_AUTH_STATE = { isLoading: false, isAuthenticated: true };

function useLocalDemoSignOut(): AppSignOut {
  // ponytail: no accounts in local-demo — sign-out affordances are hidden
  // via supportsSignOut, this exists only to keep the hook shape uniform.
  return useCallback(async () => {}, []);
}

// The auth pages redirect a signed-in user away, and local-demo is always signed in.
function NoScreen() {
  return null;
}

export const localDemoAdapter: AuthAdapter = {
  Provider: LocalDemoProvider,
  SignInScreen: NoScreen,
  SignUpScreen: NoScreen,
  VerifyEmailScreen: NoScreen,
  useAuth: () => LOCAL_DEMO_AUTH_STATE,
  useUser: useConvexUser,
  useSignOut: useLocalDemoSignOut,
  useUpdateProfileName: useConvexUpdateProfileName,
  useConvexAuth: () => LOCAL_DEMO_CONVEX_AUTH_STATE,
  supportsSignOut: false,
  emailChangeHint: "Email changes are managed through your account settings.",
};
