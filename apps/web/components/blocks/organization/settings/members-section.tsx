"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, RotateCw, X, Clock } from "lucide-react";
import { MemberRow } from "../member-row";
import { InviteMemberDialog } from "../invite-member-dialog";
import { RoleBadge } from "@/components/ui/role-badge";
import { formatDistanceToNow } from "date-fns";
import { getErrorMessage } from "@/lib/errors";

interface MembersSectionProps {
  organizationId: Id<"organizations">;
  organization: Doc<"organizations"> | null | undefined;
}

function MembersSectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-28 rounded-md" />
      <div className="rounded-lg border divide-y">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 p-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded-sm" />
              <Skeleton className="h-3 w-56 max-w-full rounded-sm" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MembersSection({
  organizationId,
  organization,
}: MembersSectionProps) {
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const members = useQuery(api.organizations.members.list, { organizationId });
  const myRole = useQuery(api.organizations.members.getMyRole, { organizationId });
  const currentUser = useQuery(api.users.core.current);
  const pendingInvitations = useQuery(
    api.organizations.invitations.listPending,
    myRole === "owner" || myRole === "admin" ? { organizationId } : "skip"
  );

  const resendInvitation = useMutation(api.organizations.invitations.resend);
  const revokeInvitation = useMutation(api.organizations.invitations.revoke);

  const canInvite = myRole === "owner" || myRole === "admin";
  const isLoading =
    members === undefined ||
    myRole === undefined ||
    currentUser === undefined ||
    (canInvite && pendingInvitations === undefined);

  const handleResend = async (
    organizationInvitationId: Id<"organizationInvitations">
  ) => {
    try {
      await resendInvitation({ organizationInvitationId });
      toast.success("Invitation resent");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to resend invitation")
      );
    }
  };

  const handleRevoke = async (
    organizationInvitationId: Id<"organizationInvitations">
  ) => {
    try {
      await revokeInvitation({ organizationInvitationId });
      toast.success("Invitation revoked");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to revoke invitation")
      );
    }
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <MembersSectionSkeleton />
      ) : (
        <>
          <div className="space-y-4">
            {canInvite && (
              <Button variant="outline" size="sm" onClick={() => setInviteDialogOpen(true)} className="">
                <UserPlus className="size-4" />
                Add member
              </Button>
            )}

            {/* Member List */}
            <div className="rounded-lg border divide-y">
              {(members ?? []).map((member) => (
                <MemberRow
                  key={member._id}
                  member={member}
                  organizationId={organizationId}
                  currentUserRole={myRole}
                  isCurrentUser={currentUser?._id === member._id}
                />
              ))}
            </div>
          </div>

          {/* Pending Invitations */}
          {canInvite && pendingInvitations && pendingInvitations.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-3">
                  Pending Invitations ({pendingInvitations.length})
                </h4>
                <div className="space-y-2">
                  {pendingInvitations.map((invitation) => (
                    <div
                      key={invitation._id}
                      className="flex items-center justify-between py-4 px-4 rounded-md border bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-full bg-muted flex items-center justify-center">
                          <Clock className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{invitation.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Invited{" "}
                            {formatDistanceToNow(invitation.createdAt, {
                              addSuffix: true,
                            })}{" "}
                            · Expires{" "}
                            {formatDistanceToNow(invitation.expiresAt, {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <RoleBadge label={invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)} className="mr-2" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResend(invitation._id)}
                        >
                          <RotateCw className="size-3" />
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(invitation._id)}
                        >
                          <X className="size-3" />
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Invite Dialog */}
      <InviteMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        organizationId={organizationId}
        organizationName={organization?.name || "Organization"}
      />
    </div>
  );
}
