"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Mail,
  XCircle,
} from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type InvitationDisplayState =
  | "loading"
  | "ready-to-accept"
  | "not-authenticated"
  | "unauthorized"
  | "accepting"
  | "success"
  | "expired"
  | "revoked"
  | "already-accepted"
  | "invalid"
  | "error";

export interface InvitationStateCardInvitation {
  email: string;
  inviterName?: string | null;
  organizationName: string;
  role: string;
}

interface InvitationStateCardProps {
  acceptedOrgSlug?: string;
  displayState: InvitationDisplayState;
  errorMessage?: string;
  invitation?: InvitationStateCardInvitation | null;
  onGoDashboard?: () => void;
  onGoHome?: () => void;
  onGoOrganizations?: () => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onTryAgain?: () => void;
}

export function InvitationStateCard({
  acceptedOrgSlug,
  displayState,
  errorMessage,
  invitation,
  onGoDashboard,
  onGoHome,
  onGoOrganizations,
  onSignIn,
  onSignOut,
  onTryAgain,
}: InvitationStateCardProps) {
  return (
    <Card className="w-full max-w-md">
      {(displayState === "loading" || displayState === "ready-to-accept") && (
        <CardHeader className="text-center py-12">
          <Spinner
            size="large"
            text="Loading invitation…"
            textClassName="text-base leading-snug font-medium text-foreground"
          />
        </CardHeader>
      )}

      {displayState === "not-authenticated" && (
        <>
          <CardHeader className="text-center">
            <Mail className="size-12 mx-auto text-blue-500" />
            <CardTitle className="mt-4">Sign in required</CardTitle>
            <CardDescription>
              Sign in with the account this invitation was sent to.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              We&apos;ll show the invitation details after confirming it belongs
              to your account.
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onSignIn}>
              Sign in to accept
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "unauthorized" && (
        <>
          <CardHeader className="text-center">
            <AlertTriangle className="size-12 mx-auto text-yellow-500" />
            <CardTitle className="mt-4">Unauthorized</CardTitle>
            <CardDescription>
              This invitation is not available for the account you&apos;re signed
              in with.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              Sign out and use the account that received the invitation, or
              contact the organization admin for a new invite.
            </p>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onSignOut}>
              Sign out
            </Button>
            <Button variant="default" className="flex-1" onClick={onGoDashboard}>
              Go to dashboard
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "accepting" && (
        <CardHeader className="text-center">
          <Spinner
            size="large"
            text="Accepting invitation"
            textClassName="text-base leading-snug font-medium text-foreground"
          />
          <CardDescription>
            Please wait while we add you to the organization.
          </CardDescription>
        </CardHeader>
      )}

      {displayState === "success" && (
        <>
          <CardHeader className="text-center">
            <CheckCircle2 className="size-12 mx-auto text-green-500" />
            <CardTitle className="mt-4">Welcome!</CardTitle>
            <CardDescription>
              You&apos;ve joined{" "}
              <strong>{invitation?.organizationName || acceptedOrgSlug}</strong>
              . Redirecting you now...
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Spinner />
          </CardContent>
        </>
      )}

      {displayState === "expired" && (
        <>
          <CardHeader className="text-center">
            <XCircle className="size-12 mx-auto text-destructive" />
            <CardTitle className="mt-4">Invitation expired</CardTitle>
            <CardDescription>
              This invitation has expired. Please ask the organization admin to
              send you a new invitation.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={onGoHome}>
              Go to homepage
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "revoked" && (
        <>
          <CardHeader className="text-center">
            <XCircle className="size-12 mx-auto text-destructive" />
            <CardTitle className="mt-4">Invitation revoked</CardTitle>
            <CardDescription>
              This invitation has been cancelled. Please contact the
              organization admin if you believe this is a mistake.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={onGoHome}>
              Go to homepage
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "already-accepted" && (
        <>
          <CardHeader className="text-center">
            <CheckCircle2 className="size-12 mx-auto text-green-500" />
            <CardTitle className="mt-4">Invitation already accepted</CardTitle>
            <CardDescription>
              This invitation has already been accepted.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={onGoOrganizations}>
              Go to organizations
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "invalid" && (
        <>
          <CardHeader className="text-center">
            <XCircle className="size-12 mx-auto text-destructive" />
            <CardTitle className="mt-4">Invalid invitation</CardTitle>
            <CardDescription>
              This invitation link is invalid or doesn&apos;t exist. Please check
              the link and try again.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={onGoHome}>
              Go to homepage
            </Button>
          </CardFooter>
        </>
      )}

      {displayState === "error" && (
        <>
          <CardHeader className="text-center">
            <XCircle className="size-12 mx-auto text-destructive" />
            <CardTitle className="mt-4">Something went wrong</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardFooter className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onTryAgain}>
              Try again
            </Button>
            <Button variant="default" className="flex-1" onClick={onGoHome}>
              Go to homepage
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
