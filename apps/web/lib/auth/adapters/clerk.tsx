"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, type ConvexReactClient } from "convex/react";
import { useTheme } from "next-themes";
import { api } from "@/convex/_generated/api";
import { CLERK_THEME_VARIABLES } from "@/lib/theme/constants";
import { AUTH_REDIRECT_PARAM, buildAuthCallbackPath } from "@/lib/routing/auth-redirects";
import { useNavigation } from "@/lib/navigation";
import { appRoute } from "@/lib/navigation/routes";
import type { AppAuthState, AppSignOut, AppUserState, AuthAdapter, UpdateProfileNameInput } from "../hooks";
import { buildFullName } from "./convex-user";
import { ConvexClerkProvider } from "./convex-clerk-provider";

function ClerkAuthProvider({ client, children }: { client: ConvexReactClient; children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ClerkProvider appearance={{ variables: CLERK_THEME_VARIABLES[resolvedTheme === "dark" ? "dark" : "light"] }}>
      <ConvexClerkProvider client={client}>{children}</ConvexClerkProvider>
    </ClerkProvider>
  );
}

// Clerk prefers the redirect_url query param over fallbackRedirectUrl, which would
// skip /auth/callback (and user onboarding). Force the redirect through the callback.
function useForceRedirectUrl(): string {
  const navigation = useNavigation();
  return useMemo(() => {
    const params = new URLSearchParams(navigation.location.search);
    return buildAuthCallbackPath(params.get(AUTH_REDIRECT_PARAM));
  }, [navigation.location.search]);
}

function ClerkSignInScreen() {
  return <SignIn forceRedirectUrl={useForceRedirectUrl()} signUpUrl={appRoute.authSignUp().pathname} />;
}

function ClerkSignUpScreen() {
  return <SignUp forceRedirectUrl={useForceRedirectUrl()} signInUrl={appRoute.authSignIn().pathname} />;
}

function useClerkAppAuth(): AppAuthState {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return { isLoaded, isSignedIn: Boolean(isSignedIn), userId: userId ?? null };
}

function useClerkAppUser(): AppUserState {
  const { isLoaded, user } = useUser();
  const hasUser = Boolean(user);
  const firstName = user?.firstName ?? null;
  const lastName = user?.lastName ?? null;
  const fullName = user?.fullName ?? null;
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const imageUrl = user?.imageUrl ?? "";

  return useMemo(
    () => ({
      isLoaded,
      user: hasUser ? { firstName, lastName, fullName, email, imageUrl } : null,
    }),
    [isLoaded, hasUser, firstName, lastName, fullName, email, imageUrl]
  );
}

function useClerkSignOut(): AppSignOut {
  const { signOut } = useClerk();
  return useCallback((options) => signOut({ redirectUrl: options?.redirectUrl }), [signOut]);
}

function useClerkUpdateProfileName(): (input: UpdateProfileNameInput) => Promise<void> {
  const { user } = useUser();
  const syncProfile = useMutation(api.users.core.syncProfile);
  return useCallback(
    async (input) => {
      if (!user) return;
      // Update Clerk first; sync the name to Convex directly since the JWT
      // may not have refreshed yet.
      await user.update({
        firstName: input.firstName,
        lastName: input.lastName || undefined,
      });
      await syncProfile({ name: buildFullName(input) });
    },
    [user, syncProfile]
  );
}

// Wrapper (not a direct reference) so test files that mock "convex/react"
// without useConvexAuth don't fail at import time.
function useClerkConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  return useConvexAuth();
}

export const clerkAdapter: AuthAdapter = {
  Provider: ClerkAuthProvider,
  SignInScreen: ClerkSignInScreen,
  SignUpScreen: ClerkSignUpScreen,
  // Clerk verifies email inside its own sign-up screen.
  VerifyEmailScreen: () => null,
  useAuth: useClerkAppAuth,
  useUser: useClerkAppUser,
  useSignOut: useClerkSignOut,
  useUpdateProfileName: useClerkUpdateProfileName,
  useConvexAuth: useClerkConvexAuth,
  supportsSignOut: true,
  emailChangeHint: "Email changes are managed through your account settings.",
};
