"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { EmailPasswordSignInForm } from "@/components/blocks/auth/email-password-sign-in-form";
import { EmailPasswordSignUpForm } from "@/components/blocks/auth/email-password-sign-up-form";
import { VerifyEmailScreen } from "@/components/blocks/auth/verify-email-screen";
import { ForgotPasswordForm } from "@/components/blocks/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/blocks/auth/reset-password-form";
import { buildAuthPathWithRedirect } from "@/lib/routing/auth-redirects";
import { appRoute } from "@/lib/navigation/routes";
import { useNavigationLocation } from "@/lib/navigation";
import type { AppAuthState, AppSignOut, AuthAdapter } from "../hooks";
import { useConvexUpdateProfileName, useConvexUser } from "./convex-user";

const PUBLIC_PATHS = [
  appRoute.authSignIn().pathname,
  appRoute.authSignUp().pathname,
  appRoute.authVerifyEmail().pathname,
  appRoute.authForgotPassword().pathname,
  appRoute.authResetPassword().pathname,
];

// Set by sign-out, which navigates itself; the gate must not race it to sign-in.
let isSigningOut = false;

/** Sends a page whose session ends while open to sign-in; proxy.ts gates page loads (docs/specs/auth-adapters.md#route-gate). */
function SignedOutRedirect() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  // The provider sits outside NavigationProvider; the location hook works without it.
  const { pathname } = useNavigationLocation();
  const mustSignIn = !isLoading && !isAuthenticated && !PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (!mustSignIn || isSigningOut) return;
    const { pathname, search, hash, origin } = window.location;
    window.location.replace(buildAuthPathWithRedirect(appRoute.authSignIn().pathname, `${pathname}${search}${hash}`, origin));
  }, [mustSignIn]);

  return null;
}

// The session provider, with its own Convex client, is ConvexAuthServerProvider in the root layout.
function ConvexAuthAdapterProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedOutRedirect />
      {children}
    </>
  );
}

/** The session id (`sub`) of a Convex Auth access token: stable across refreshes. */
function sessionIdFromToken(token: string | null): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const { sub } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

function useConvexAppAuth(): AppAuthState {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const sessionId = sessionIdFromToken(useAuthToken());
  return useMemo(
    () => ({ isLoaded: !isLoading, isSignedIn: isAuthenticated, userId: isAuthenticated ? sessionId : null }),
    [isLoading, isAuthenticated, sessionId]
  );
}

function useConvexSignOut(): AppSignOut {
  const { signOut } = useAuthActions();
  return useCallback(
    async (options) => {
      isSigningOut = true;
      try {
        await signOut();
      } finally {
        window.location.assign(options?.redirectUrl ?? appRoute.authSignIn().pathname);
      }
    },
    [signOut]
  );
}

// Wrapper (not a direct reference) so test files that mock "convex/react"
// without useConvexAuth don't fail at import time.
function useConvexAuthState(): { isLoading: boolean; isAuthenticated: boolean } {
  return useConvexAuth();
}

export const convexAdapter: AuthAdapter = {
  Provider: ConvexAuthAdapterProvider,
  SignInScreen: EmailPasswordSignInForm,
  SignUpScreen: EmailPasswordSignUpForm,
  VerifyEmailScreen,
  ForgotPasswordScreen: ForgotPasswordForm,
  ResetPasswordScreen: ResetPasswordForm,
  useAuth: useConvexAppAuth,
  useUser: useConvexUser,
  useSignOut: useConvexSignOut,
  useUpdateProfileName: useConvexUpdateProfileName,
  useConvexAuth: useConvexAuthState,
  supportsSignOut: true,
  emailChangeHint: null,
};
