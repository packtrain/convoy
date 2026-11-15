"use client";

import { useCallback, useMemo } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isLocalDemoAuthMode } from "./auth-mode";

/**
 * App auth hooks (OS-1230). Product code uses these instead of Clerk hooks
 * directly, so the local-demo build can run without ClerkProvider. The
 * implementation is selected once at module scope from the build-time auth
 * mode, so rules-of-hooks are preserved.
 */

export type AppAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

export type AppUser = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string;
  imageUrl: string;
};

export type AppUserState = {
  isLoaded: boolean;
  user: AppUser | null;
};

export type AppSignOut = (options?: { redirectUrl?: string }) => Promise<void>;

export type UpdateProfileNameInput = {
  firstName: string;
  lastName?: string;
};

/** False in local-demo mode: there is no account to sign out of. */
export const supportsSignOut = !isLocalDemoAuthMode;

const LOCAL_DEMO_USER_ID = "local-demo";

function buildFullName({ firstName, lastName }: UpdateProfileNameInput): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

// --- Clerk implementations -------------------------------------------------

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
  return useCallback(
    (options) => signOut({ redirectUrl: options?.redirectUrl }),
    [signOut]
  );
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

// --- Local-demo implementations ---------------------------------------------

// Stable references — consumers may use these objects as effect/memo deps.
const LOCAL_DEMO_AUTH_STATE: AppAuthState = {
  isLoaded: true,
  isSignedIn: true,
  userId: LOCAL_DEMO_USER_ID,
};
const LOCAL_DEMO_CONVEX_AUTH_STATE = { isLoading: false, isAuthenticated: true };

function useLocalDemoAuth(): AppAuthState {
  return LOCAL_DEMO_AUTH_STATE;
}

function useLocalDemoUser(): AppUserState {
  const user = useQuery(api.users.core.current);
  return useMemo(() => {
    if (user === undefined) return { isLoaded: false, user: null };
    if (user === null) return { isLoaded: true, user: null };
    const [firstName, ...rest] = user.name.split(" ");
    return {
      isLoaded: true,
      user: {
        firstName: firstName || null,
        lastName: rest.length > 0 ? rest.join(" ") : null,
        fullName: user.name,
        email: user.email,
        imageUrl: user.avatarUrl ?? "",
      },
    };
  }, [user]);
}

function useLocalDemoSignOut(): AppSignOut {
  // ponytail: no accounts in local-demo — sign-out affordances are hidden
  // via supportsSignOut, this exists only to keep the hook shape uniform.
  return useCallback(async () => {}, []);
}

function useLocalDemoUpdateProfileName(): (input: UpdateProfileNameInput) => Promise<void> {
  const syncProfile = useMutation(api.users.core.syncProfile);
  return useCallback(
    async (input) => {
      await syncProfile({ name: buildFullName(input) });
    },
    [syncProfile]
  );
}

function useLocalDemoConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  return LOCAL_DEMO_CONVEX_AUTH_STATE;
}

// --- Selected implementations -----------------------------------------------

export const useAppAuth = isLocalDemoAuthMode ? useLocalDemoAuth : useClerkAppAuth;
export const useAppUser = isLocalDemoAuthMode ? useLocalDemoUser : useClerkAppUser;
export const useAppSignOut = isLocalDemoAuthMode ? useLocalDemoSignOut : useClerkSignOut;
export const useAppUpdateProfileName = isLocalDemoAuthMode
  ? useLocalDemoUpdateProfileName
  : useClerkUpdateProfileName;
// Wrapper (not a direct reference) so test files that mock "convex/react"
// without useConvexAuth don't fail at import time.
function useClerkConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  return useConvexAuth();
}

/** Drop-in for convex/react's useConvexAuth; always authenticated in local-demo. */
export const useAppConvexAuth = isLocalDemoAuthMode ? useLocalDemoConvexAuth : useClerkConvexAuth;
