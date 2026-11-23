"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppSignOut } from "@/lib/auth/hooks";
import { useAppAuthReadiness } from "@/lib/auth/use-app-auth-readiness";
import { AlertCircle, LogIn, RefreshCw } from "lucide-react";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import { buildAuthPathWithRedirect } from "@/lib/routing/auth-redirects";
import { appRoute } from "@/lib/navigation/routes";

interface RouteErrorStateProps {
  error?: Error & { digest?: string };
  variant?: RouteErrorVariant;
  /** Error-boundary reset; called once auth settles after a pending window. */
  onRecover?: () => void;
}

export type RouteErrorVariant = "auth" | "generic";

const AUTH_ERROR_PATTERNS = ["not authenticated", "could not verify authentication", "no auth provider found"];

export function isAuthenticationRouteError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function getCurrentLocalUrl(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getSignInUrl(): string {
  if (typeof window === "undefined") return appRoute.authSignIn().pathname;
  return buildAuthPathWithRedirect(appRoute.authSignIn().pathname, getCurrentLocalUrl(), window.location.origin);
}

export function RouteErrorState({ error, variant, onRecover }: RouteErrorStateProps) {
  const signOut = useAppSignOut();
  const { status: authStatus } = useAppAuthReadiness();
  const resolvedVariant = variant ?? (error && isAuthenticationRouteError(error) ? "auth" : "generic");
  const isAuthError = resolvedVariant === "auth";

  // A boundary-caught auth error (no explicit variant) may be a transient
  // Convex re-auth: wait for readiness to settle before showing the error.
  const isSettling = isAuthError && !variant && authStatus === "loading";
  const [sawSettling, setSawSettling] = useState(isSettling);
  if (isSettling && !sawSettling) setSawSettling(true);
  const shouldRecover = sawSettling && authStatus === "authenticated" && onRecover !== undefined;

  useEffect(() => {
    if (shouldRecover) onRecover();
  }, [shouldRecover, onRecover]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSignInAgain = useCallback(async () => {
    const redirectUrl = getSignInUrl();

    try {
      await signOut({ redirectUrl });
    } catch {
      window.location.assign(redirectUrl);
    }
  }, [signOut]);

  if (isSettling || shouldRecover) {
    return (
      <Centered variant="screen">
        <Spinner size="large" text="Authorizing" />
      </Centered>
    );
  }

  return (
    <Centered as="main" variant="screen" className="bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex size-11 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
          <AlertCircle className="size-5" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          {isAuthError ? "Your session needs to be refreshed" : "Could not load this page"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {isAuthError
            ? "We could not verify your sign-in, so protected workspace data was not loaded. This can happen when your session expires or the authentication service is unavailable."
            : "Something interrupted this view while it was loading. Try again, or sign in again if the problem started after your session changed."}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={handleReload} className="sm:flex-1">
            <RefreshCw data-icon="inline-start" className="size-4" />
            Try again
          </Button>
          <Button type="button" variant="outline" onClick={handleSignInAgain} className="sm:flex-1">
            <LogIn data-icon="inline-start" className="size-4" />
            Sign in again
          </Button>
        </div>

        {error?.digest ? (
          <p className="mt-4 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">Error ID: {error.digest}</p>
        ) : null}
      </section>
    </Centered>
  );
}
