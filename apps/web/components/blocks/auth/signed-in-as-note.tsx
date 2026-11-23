"use client";

import { useAppSignOut, useAppUser } from "@/lib/auth/hooks";

/**
 * "Approving as <name>" note with an inline sign-out link, shared by the
 * CLI browser-login pages and the OAuth authorize page. Signing out sends
 * the user back to the current URL, so Clerk's sign-in preserves the
 * challenge/consent query string.
 */
export function SignedInAsNote() {
  const { user } = useAppUser();
  const signOut = useAppSignOut();

  if (!user) return null;
  const email = user.email || undefined;

  return (
    <p className="text-sm text-muted-foreground">
      Approving as{" "}
      <span className="font-medium text-foreground" title={email}>
        {user.fullName ?? email}
      </span>
      . Wrong account?{" "}
      <button
        type="button"
        className="cursor-pointer underline underline-offset-2 hover:text-foreground"
        onClick={() => signOut({ redirectUrl: window.location.href })}
      >
        Sign out
      </button>{" "}
      to switch.
    </p>
  );
}
