"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { api } from "@/convex/_generated/api";
import { Centered } from "@/components/custom/centered";
import {
  ApprovalRequestCard,
  type ApprovalDisplayState,
} from "@/components/blocks/auth/approval-request-card";
import { useNavigation } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

type SubmitState = "idle" | "submitting" | "approved" | "denied" | "error";

/**
 * Approve page for the CLI browser-login flow (link path). The challenge id
 * arrives via `?challenge=`; approving records this user on the request so
 * the polling CLI can mint its key. See docs/specs/cli-browser-login.md.
 */
export default function CliLoginApprovePage() {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();

  const challengeId = useMemo(
    () => new URLSearchParams(navigation.location.search).get("challenge") ?? "",
    [navigation.location.search]
  );

  const request = useQuery(
    api.cli.login.getByChallenge,
    isAuthenticated && challengeId ? { challengeId } : "skip"
  );

  const approve = useMutation(api.cli.login.approve);
  const deny = useMutation(api.cli.login.deny);

  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const runDecision = async (decision: "approve" | "deny") => {
    setSubmitState("submitting");
    try {
      await (decision === "approve" ? approve({ challengeId }) : deny({ challengeId }));
      setSubmitState(decision === "approve" ? "approved" : "denied");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Request failed"));
      setSubmitState("error");
    }
  };

  const displayState: ApprovalDisplayState = (() => {
    if (submitState === "submitting") return "submitting";
    if (submitState === "approved") return "approved";
    if (submitState === "denied") return "denied";
    if (submitState === "error") return "error";
    if (!challengeId) return "not-found";
    if (!isAuthenticated || request === undefined) return "loading";
    if (request === null) return "not-found";
    if (request.status === "approved") return "approved";
    if (request.status === "denied") return "denied";
    return "ready";
  })();

  return (
    <Centered variant="screen" className="bg-background p-4">
      <ApprovalRequestCard
        title="Approve CLI login"
        description="A command-line tool is asking to access your Convoy account. Only approve if you just started this login yourself."
        subjectLabel="Machine"
        subject={request?.hostname}
        state={displayState}
        errorMessage={errorMessage}
        approvedMessage="You can return to your terminal."
        onApprove={() => runDecision("approve")}
        onDeny={() => runDecision("deny")}
      />
    </Centered>
  );
}
