"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/custom/empty-state";
import { ProjectMemberRow } from "./project-member-row";
import { AddProjectMemberDialog } from "./add-project-member-dialog";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";

interface MembersSectionProps {
  projectId: Id<"projects">;
  organizationId: Id<"organizations">;
  /**
   * Overrides the project-role check, for org-settings callers whose authority
   * is `PROJECTS_MANAGE_ALL` (OS-1534) — something `getMyRole` cannot report.
   */
  canManage?: boolean;
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
  projectId,
  organizationId,
  canManage,
}: MembersSectionProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Queries
  const members = useQuery(api.projects.members.list, { projectId });
  const permissions = useProjectPermissions(projectId);
  const currentUser = useQuery(api.users.core.current);

  const canManageMembers = canManage ?? permissions.canManageMembers;
  const isLoading =
    members === undefined ||
    permissions.myRole === undefined ||
    currentUser === undefined;

  const projectMembers = members ?? [];

  return (
    <div className="space-y-6">
      {isLoading ? (
        <MembersSectionSkeleton />
      ) : projectMembers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Add members to give them access to this project."
          action={
            canManageMembers ? (
              <Button variant="secondary" onClick={() => setAddDialogOpen(true)}>
                <UserPlus className="size-4" />
                Add member
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {canManageMembers && (
            <Button
              variant="outline"
              size="settings"
              onClick={() => setAddDialogOpen(true)}
            >
              <UserPlus className="size-4" />
              Add member
            </Button>
          )}

          <div className="rounded-lg border divide-y">
            {projectMembers.map((member) => (
              <ProjectMemberRow
                key={member._id}
                member={member}
                projectId={projectId}
                canManage={canManageMembers}
                isCurrentUser={currentUser?._id === member.userId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      <AddProjectMemberDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        projectId={projectId}
        organizationId={organizationId}
      />
    </div>
  );
}
