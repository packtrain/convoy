"use client";

import { AlertTriangle, CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import { SignedInAsNote } from "@/components/blocks/auth/signed-in-as-note";
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

export type ApprovalDisplayState =
  | "loading"
  | "not-found"
  | "ready"
  | "submitting"
  | "approved"
  | "denied"
  | "error";

interface ApprovalRequestCardProps {
  /** e.g. "Approve CLI login" / "Authorize application" */
  title: string;
  /** Context copy shown under the title while the request is pending. */
  description: string;
  /** e.g. "Machine" / "Application" */
  subjectLabel?: string;
  /** e.g. the CLI hostname or the OAuth client name */
  subject?: string | null;
  state: ApprovalDisplayState;
  errorMessage?: string;
  /** Shown in the success state, e.g. "You can return to your terminal." */
  approvedMessage?: string;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Shared approve/deny confirmation used by the CLI browser-login pages
 * (/cli-login, /device) and the MCP OAuth authorize page.
 */
export function ApprovalRequestCard({
  title,
  description,
  subjectLabel,
  subject,
  state,
  errorMessage,
  approvedMessage,
  onApprove,
  onDeny,
}: ApprovalRequestCardProps) {
  return (
    <Card className="w-full max-w-md gap-6 py-6">
      {state === "loading" && (
        <CardHeader className="text-center py-12">
          <Spinner size="large" text="Loading request…" />
        </CardHeader>
      )}

      {state === "not-found" && (
        <CardHeader className="px-6 text-center">
          <AlertTriangle className="size-12 mx-auto text-muted-foreground" />
          <CardTitle>Request not found</CardTitle>
          <CardDescription>
            This request is invalid, was already used, or has expired. Start
            the login again from your terminal.
          </CardDescription>
        </CardHeader>
      )}

      {(state === "ready" || state === "submitting") && (
        <>
          <CardHeader className="px-6 text-center">
            <ShieldQuestion className="size-8 mx-auto text-primary" />
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 text-sm">
            <CardDescription>{description}</CardDescription>
            <div className="space-y-1.5">
              {subject && (
                <p>
                  {subjectLabel && (
                    <span className="text-muted-foreground">{subjectLabel}: </span>
                  )}
                  <span className="font-mono font-medium">{subject}</span>
                </p>
              )}
              <SignedInAsNote />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-3 px-6">
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={state === "submitting"}
              onClick={onDeny}
            >
              Deny
            </Button>
            <Button
              className="cursor-pointer"
              disabled={state === "submitting"}
              onClick={onApprove}
            >
              Approve
            </Button>
          </CardFooter>
        </>
      )}

      {state === "approved" && (
        <CardHeader className="px-6 text-center">
          <CheckCircle2 className="size-12 mx-auto text-primary" />
          <CardTitle>Approved</CardTitle>
          <CardDescription>
            {approvedMessage ?? "You can close this page."}
          </CardDescription>
        </CardHeader>
      )}

      {state === "denied" && (
        <CardHeader className="px-6 text-center">
          <XCircle className="size-12 mx-auto text-destructive" />
          <CardTitle>Denied</CardTitle>
          <CardDescription>
            The request was denied. Nothing was shared.
          </CardDescription>
        </CardHeader>
      )}

      {state === "error" && (
        <CardHeader className="px-6 text-center">
          <AlertTriangle className="size-12 mx-auto text-destructive" />
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>{errorMessage || "Please try again."}</CardDescription>
        </CardHeader>
      )}
    </Card>
  );
}
