"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { AppUserState, UpdateProfileNameInput } from "../hooks";

// The profile from our `users` row, for adapters with no external profile.

export function buildFullName({ firstName, lastName }: UpdateProfileNameInput): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

export function useConvexUser(): AppUserState {
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

export function useConvexUpdateProfileName(): (input: UpdateProfileNameInput) => Promise<void> {
  const syncProfile = useMutation(api.users.core.syncProfile);
  return useCallback(
    async (input) => {
      await syncProfile({ name: buildFullName(input) });
    },
    [syncProfile]
  );
}

