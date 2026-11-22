"use client";

import type { ComponentType, ReactNode } from "react";
import type { ConvexReactClient } from "convex/react";
import { authMode, type AuthMode } from "./auth-mode";
import { clerkAdapter } from "./adapters/clerk";
import { convexAdapter } from "./adapters/convex";
import { localDemoAdapter } from "./adapters/local-demo";

/**
 * App auth hooks (docs/specs/auth-adapters.md). Product code uses these instead of
 * a provider's hooks. The adapter is selected once at module scope from the
 * build-time auth mode, so rules-of-hooks are preserved.
 */

export type AppAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  /** Opaque key for in-memory caches. Not a stable user id: Convex Auth gives the session id. */
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

export type AuthAdapter = {
  /** Wraps the app; gives the Convex client its auth. */
  Provider: ComponentType<{ client: ConvexReactClient; children: ReactNode }>;
  SignInScreen: ComponentType;
  SignUpScreen: ComponentType;
  /** Landing page of the emailed sign-up link. */
  VerifyEmailScreen: ComponentType;
  useAuth: () => AppAuthState;
  useUser: () => AppUserState;
  useSignOut: () => AppSignOut;
  useUpdateProfileName: () => (input: UpdateProfileNameInput) => Promise<void>;
  useConvexAuth: () => { isLoading: boolean; isAuthenticated: boolean };
  /** False when there is no account to sign out of. */
  supportsSignOut: boolean;
  /** Shown under the read-only email in user settings, or nothing. */
  emailChangeHint: string | null;
};

const AUTH_ADAPTERS: Record<AuthMode, AuthAdapter> = {
  clerk: clerkAdapter,
  "local-demo": localDemoAdapter,
  convex: convexAdapter,
};

const adapter = AUTH_ADAPTERS[authMode];

export const AuthProvider = adapter.Provider;
export const SignInScreen = adapter.SignInScreen;
export const SignUpScreen = adapter.SignUpScreen;
export const VerifyEmailScreen = adapter.VerifyEmailScreen;
export const supportsSignOut = adapter.supportsSignOut;
export const emailChangeHint = adapter.emailChangeHint;
export const useAppAuth = adapter.useAuth;
export const useAppUser = adapter.useUser;
export const useAppSignOut = adapter.useSignOut;
export const useAppUpdateProfileName = adapter.useUpdateProfileName;
/** Drop-in for convex/react's useConvexAuth; always authenticated in local-demo. */
export const useAppConvexAuth = adapter.useConvexAuth;
