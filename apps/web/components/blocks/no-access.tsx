"use client";

import { useAppSignOut } from "@/lib/auth/hooks";
import { Centered } from "@/components/custom/centered";
import { Button } from "@/components/ui/button";
import { AppLink, appRoute, href } from "@/lib/navigation";
import { House, ShieldX } from "lucide-react";

interface NoAccessProps {
  organizationSlug: string;
  message?: string;
}

export function NoAccess({
  organizationSlug,
  message = "You don't have access to this organization.",
}: NoAccessProps) {
  const signOut = useAppSignOut();

  const handleSignInDifferent = () => {
    signOut({
      redirectUrl: href(appRoute.authSignIn(href(appRoute.organization(organizationSlug)))),
    });
  };

  return (
    <Centered variant="screen">
      <div className="max-w-md px-4 text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <ShieldX className="size-8 text-destructive" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold">No access</h1>
        <p className="mb-4 text-muted-foreground">{message}</p>
        <p className="mb-6 rounded bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
          {organizationSlug}
        </p>

        <div className="flex flex-col gap-2">
          <Button asChild>
            <AppLink href={appRoute.home()}>
              <House data-icon="inline-start" />
              Go to another organization
            </AppLink>
          </Button>
          <Button
            type="button"
            onClick={handleSignInDifferent}
            variant="outline"
          >
            Sign in with different account
          </Button>
        </div>
      </div>
    </Centered>
  );
}
