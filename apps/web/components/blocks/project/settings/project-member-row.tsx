"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ProjectRoleSelect,
  getProjectRoleLabel,
  type ProjectRoleValue,
} from "@/components/blocks/project/project-role-select";
import { RoleBadge } from "@/components/ui/role-badge";
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
import { showConvexErrorToast } from "@/lib/errors";
import { getInitials } from "@/lib/utils";

interface ProjectMemberRowProps {
  member: {
    _id: Id<"projectMembers">;
    userId: Id<"users">;
    role: string;
    name: string;
    email: string;
    avatarUrl?: string;
  };
  projectId: Id<"projects">;
  canManage: boolean;
  isCurrentUser: boolean;
}

export function ProjectMemberRow({
  member,
  projectId,
  canManage,
  isCurrentUser,
}: ProjectMemberRowProps) {
  const updateRole = useMutation(api.projects.members.updateRole);
  const removeMember = useMutation(api.projects.members.remove);

  const handleRoleChange = async (newRole: ProjectRoleValue) => {
    try {
      await updateRole({
        projectId,
        userId: member.userId,
        role: newRole,
      });
      toast.success("Role updated");
    } catch (error) {
      showConvexErrorToast(error, "Failed to update role");
    }
  };

  const handleRemove = async () => {
    try {
      await removeMember({
        projectId,
        userId: member.userId,
      });
      toast.success("Member removed");
    } catch (error) {
      showConvexErrorToast(error, "Failed to remove member");
    }
  };

  const canChangeRole = canManage;
  const canRemove = canManage;

  return (
    <div className="flex items-center gap-3 p-4">
      <Avatar className="size-9">
        <AvatarImage src={member.avatarUrl} />
        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {member.name}
          {isCurrentUser && (
            <span className="text-muted-foreground ml-1">(you)</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {canChangeRole ? (
          <ProjectRoleSelect
            value={member.role}
            onValueChange={handleRoleChange}
            variant="badge"
          />
        ) : (
          <RoleBadge label={getProjectRoleLabel(member.role)} />
        )}

        {canRemove && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${member.name}`}
              >
                <X />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member?</AlertDialogTitle>
                <AlertDialogDescription>
                  {member.name} will lose access to this project and all its
                  tasks. This action cannot be undone.
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
