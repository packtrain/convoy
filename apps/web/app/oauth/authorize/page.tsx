"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { api } from "@/convex/_generated/api";
import { Centered } from "@/components/custom/centered";
import {
  ApprovalRequestCard,
  type ApprovalDisplayState,
} from "@/components/blocks/auth/approval-request-card";
import { isRedirectUriAllowed } from "@/lib/oauth/redirect-uris";
import { useNavigation } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

type SubmitState = "idle" | "submitting" | "error";

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * OAuth 2.1 consent page for the MCP OAuth flow (OS-1192). MCP clients
 * (e.g. Claude Code's /mcp) land here via the authorization server metadata;
 * approving mints a one-time code and redirects back to the client, which
 * exchanges it (PKCE-gated) at /oauth/token. See docs/specs/mcp-oauth.md.
 */
export default function OAuthAuthorizePage() {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();

  const params = useMemo(
    () => new URLSearchParams(navigation.location.search),
    [navigation.location.search]
  );
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? undefined;
  const responseType = params.get("response_type") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  const client = useQuery(
    api.oauth.core.getClient,
    isAuthenticated && clientId ? { clientId } : "skip"
  );

  const approve = useMutation(api.oauth.core.approve);

  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hasRedirected = useRef(false);

  const redirectAllowed = Boolean(client && isRedirectUriAllowed(client.redirectUris, redirectUri));

  // RFC 6749: protocol errors for a valid client + registered redirect URI
  // must be returned to the callback (with state), not stranded on our page.
  const protocolError = (() => {
    if (responseType !== "code") {
      return { code: "unsupported_response_type", message: "Only response_type=code is supported." };
    }
    if (!codeChallenge || codeChallengeMethod !== "S256" || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
      return { code: "invalid_request", message: "This client did not send a valid PKCE (S256) challenge." };
    }
    return null;
  })();

  useEffect(() => {
    if (!protocolError || !redirectAllowed || hasRedirected.current) return;
    hasRedirected.current = true;
    const target = new URL(redirectUri);
    target.searchParams.set("error", protocolError.code);
    if (state !== undefined) target.searchParams.set("state", state);
    window.location.assign(target.toString());
  }, [protocolError, redirectAllowed, redirectUri, state]);

  const requestProblem = (() => {
    if (!clientId || !redirectUri) return "Missing client_id or redirect_uri.";
    if (client && !redirectAllowed) return "The redirect URI is not registered for this client.";
    return protocolError?.message ?? null;
  })();

  const handleApprove = async () => {
    setSubmitState("submitting");
    try {
      const { redirectTo } = await approve({
        clientId,
        redirectUri,
        codeChallenge,
        responseType,
        state,
      });
      window.location.assign(redirectTo);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Authorization failed"));
      setSubmitState("error");
    }
  };

  const handleDeny = () => {
    // Only redirect to registered URIs; otherwise this would be an open redirect.
    if (redirectAllowed) {
      const target = new URL(redirectUri);
      target.searchParams.set("error", "access_denied");
      if (state !== undefined) target.searchParams.set("state", state);
      window.location.assign(target.toString());
      return;
    }
    window.history.back();
  };

  const displayState: ApprovalDisplayState = (() => {
    if (submitState === "submitting") return "submitting";
    if (submitState === "error") return "error";
    if (!clientId || !redirectUri) return "error";
    if (!isAuthenticated || (clientId && client === undefined)) return "loading";
    if (client === null) return "not-found";
    // Protocol errors bounce to the callback; show a spinner while leaving.
    if (protocolError && redirectAllowed) return "loading";
    if (requestProblem) return "error";
    return "ready";
  })();

  return (
    <Centered variant="screen" className="bg-background p-4">
      <ApprovalRequestCard
        title="Authorize application"
        description="This application is asking for API access to your Convoy account. It will be able to view and manage tasks, projects, and related data on your behalf."
        subjectLabel="Application"
        subject={client?.clientName ?? clientId.slice(0, 12)}
        state={displayState}
        errorMessage={errorMessage || requestProblem || ""}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />
    </Centered>
  );
}
