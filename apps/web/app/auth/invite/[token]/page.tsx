"use client";

import { useEffect, useState, useCallback, useRef, startTransition } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAppAuth, useAppSignOut } from "@/lib/auth/hooks";
import { api } from "@/convex/_generated/api";
import {
  InvitationStateCard,
  type InvitationDisplayState,
} from "@/components/blocks/auth/invitation-state-card";
import { Centered } from "@/components/custom/centered";
import { appRoute, useNavigation, useRouteParams } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

type AcceptState = "idle" | "accepting" | "success" | "error";

export default function InviteAcceptPage() {
  const params = useRouteParams<{ token: string }>();
  const navigation = useNavigation();
  const token = params.token;

  const { isLoaded: isAuthLoaded, isSignedIn } = useAppAuth();
  const signOut = useAppSignOut();

  const [acceptState, setAcceptState] = useState<AcceptState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [acceptedOrgSlug, setAcceptedOrgSlug] = useState<string>("");
  const hasTriggeredAccept = useRef(false);

  // Check Convex authentication (may lag behind Clerk)
  const convexUser = useQuery(api.users.core.current);

  // Fetch invitation details
  const invitation = useQuery(
    api.organizations.invitations.getByToken,
    token ? { token } : "skip"
  );

  const acceptInvitation = useMutation(api.organizations.invitations.accept);
  const onboard = useMutation(api.users.core.onboard);

  // Onboard user if signed in with Clerk but not in Convex DB yet
  useEffect(() => {
    if (isSignedIn && convexUser === null) {
      onboard().catch(console.error);
    }
  }, [isSignedIn, convexUser, onboard]);

  const handleAccept = useCallback(async () => {
    if (hasTriggeredAccept.current) return;
    hasTriggeredAccept.current = true;

    startTransition(() => {
      setAcceptState("accepting");
    });

    try {
      const result = await acceptInvitation({ token });
      startTransition(() => {
        setAcceptedOrgSlug(result.organizationSlug);
        setAcceptState("success");
      });

      // Redirect to organization after short delay
      setTimeout(() => {
        navigation.push(appRoute.organization(result.organizationSlug));
      }, 2000);
    } catch (error) {
      startTransition(() => {
        setErrorMessage(
          getErrorMessage(error, "Failed to accept invitation")
        );
        setAcceptState("error");
      });
    }
  }, [acceptInvitation, navigation, token]);

  // Compute display state from reactive values
  const computeDisplayState = (): InvitationDisplayState => {
    // Override with accept states if active
    if (acceptState === "accepting") return "accepting";
    if (acceptState === "success") return "success";
    if (acceptState === "error") return "error";

    // Loading state while auth is loading
    if (!isAuthLoaded) return "loading";

    // Not authenticated (Clerk)
    if (!isSignedIn) return "not-authenticated";

    // Still loading invitation
    if (invitation === undefined) return "loading";

    // Invalid token
    if (invitation === null) return "invalid";

    // Wait for Convex auth to sync (prevents "Not authenticated" errors)
    // undefined = still loading, null = not authenticated in Convex yet
    if (convexUser === undefined || convexUser === null) return "loading";

    if (invitation.access === "requires-authentication")
      return "not-authenticated";
    if (invitation.access === "unauthorized") return "unauthorized";

    // Check invitation status
    if (invitation.status === "accepted") return "already-accepted";
    if (invitation.status === "revoked") return "revoked";
    if (invitation.status === "expired" || invitation.isExpired)
      return "expired";

    // Ready to accept
    return "ready-to-accept";
  };

  const displayState = computeDisplayState();

  // Auto-accept when ready
  useEffect(() => {
    if (displayState === "ready-to-accept") {
      handleAccept();
    }
  }, [displayState, handleAccept]);

  const handleSignIn = () => {
    // Redirect to sign-in with return URL
    const returnUrl = `/auth/invite/${token}`;
    navigation.push(appRoute.authSignIn(returnUrl));
  };

  const handleSignOut = () => {
    signOut({ redirectUrl: `/auth/invite/${token}` });
  };

  const invitationDetails =
    invitation?.access === "authorized" ? invitation : null;

  return (
    <Centered variant="screen" className="bg-background p-4">
      <InvitationStateCard
        acceptedOrgSlug={acceptedOrgSlug}
        displayState={displayState}
        errorMessage={errorMessage}
        invitation={invitationDetails}
        onGoDashboard={() => navigation.push(appRoute.organizations())}
        onGoHome={() => navigation.push(appRoute.home())}
        onGoOrganizations={() => navigation.push(appRoute.organizations())}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onTryAgain={() => window.location.reload()}
      />
    </Centered>
  );
}
