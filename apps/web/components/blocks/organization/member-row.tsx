"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { X } from "lucide-react";
import { getInitials } from "@/lib/utils";
import { RoleBadge } from "@/components/ui/role-badge";
import { getErrorMessage } from "@/lib/errors";

type OrgRole = "owner" | "admin" | "member";

interface MemberRowProps {
  member: {
    _id: Id<"users">;
    name: string;
    email: string;
    avatarUrl?: string;
    role: OrgRole;
  };
  organizationId: Id<"organizations">;
  currentUserRole: OrgRole | null;
  isCurrentUser: boolean;
}

export function MemberRow({
  member,
  organizationId,
  currentUserRole,
  isCurrentUser,
}: MemberRowProps) {
  const updateRole = useMutation(api.organizations.members.updateRole);
  const removeMember = useMutation(api.organizations.members.remove);

  const canChangeRole =
    currentUserRole === "owner" ||
    (currentUserRole === "admin" && member.role !== "owner");

  const canRemove =
    !isCurrentUser &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && member.role !== "owner"));

  const handleRoleChange = async (newRole: OrgRole) => {
    try {
      await updateRole({
        organizationId,
        userId: member._id,
        newRole,
      });
      toast.success(`Role updated to ${newRole}`);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to update role")
      );
    }
  };

  const handleRemove = async () => {
    try {
      await removeMember({
        organizationId,
        userId: member._id,
      });
      toast.success("Member removed from organization");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Failed to remove member")
      );
    }
  };

  const initials = getInitials(member.name || member.email);

  return (
    <div className="flex items-center gap-3 p-4">
      <Avatar className="size-9">
        <AvatarImage src={member.avatarUrl} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {member.name || "Unnamed user"}
          {isCurrentUser && (
            <span className="text-muted-foreground ml-1">(you)</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {canChangeRole && member.role !== "owner" ? (
          <Select value={member.role} onValueChange={handleRoleChange}>
            <SelectTrigger variant="badge">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currentUserRole === "owner" && (
                <SelectItem value="owner">Owner</SelectItem>
              )}
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <RoleBadge label={member.role.charAt(0).toUpperCase() + member.role.slice(1)} />
        )}

        {canRemove && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${member.name || member.email}`}
              >
                <X />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member?</AlertDialogTitle>
                <AlertDialogDescription>
                  {member.name || member.email} will be removed from this
                  organization and all its projects. This action cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRemove}
                  variant="destructive"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
