"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient, useMutation } from "convex/react";
import { useTheme } from "next-themes";
import { ReactNode, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { isLocalDemoAuthMode } from "@/lib/auth/auth-mode";
import { CLERK_THEME_VARIABLES } from "@/lib/theme/constants";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { ConvexClerkProvider } from "./convex-clerk-provider";
import { getErrorMessage } from "@/lib/errors";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

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

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();

  if (isLocalDemoAuthMode) {
    return (
      <ConvexProvider client={convex}>
        <LocalDemoGate>{children}</LocalDemoGate>
      </ConvexProvider>
    );
  }

  return (
    <ClerkProvider appearance={{ variables: CLERK_THEME_VARIABLES[resolvedTheme === "dark" ? "dark" : "light"] }}>
      <ConvexClerkProvider client={convex}>{children}</ConvexClerkProvider>
    </ClerkProvider>
  );
}
