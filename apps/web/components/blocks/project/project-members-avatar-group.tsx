"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getInitials } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectMembersAvatarGroupProps {
  projectId: Id<"projects">;
  onMembersClick: () => void;
  maxDisplay?: number;
}

export function ProjectMembersAvatarGroup({
  projectId,
  onMembersClick,
  maxDisplay = 2,
}: ProjectMembersAvatarGroupProps) {
  const members = useQuery(api.projects.members.listAssignable, { projectId });

  // Loading state
  if (members === undefined) {
    return (
      <div className="flex -space-x-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton
            key={i}
            className="size-6 rounded-full ring-2 ring-background"
          />
        ))}
      </div>
    );
  }

  // Empty state - shouldn't happen (at least creator should be a member)
  if (members.length === 0) {
    return null;
  }

  const displayedMembers = members.slice(0, maxDisplay);
  const remainingCount = members.length - maxDisplay;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onMembersClick}
          className="flex cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AvatarGroup>
            {displayedMembers.map((member) => (
              <Avatar key={member._id} size="sm">
                <AvatarImage src={member.avatarUrl ?? undefined} alt={member.name} />
                <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
              </Avatar>
            ))}
            {remainingCount > 0 && (
              <AvatarGroupCount>+{remainingCount}</AvatarGroupCount>
            )}
          </AvatarGroup>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {members.length} {members.length === 1 ? "member" : "members"} - Click
        to manage
      </TooltipContent>
    </Tooltip>
  );
}
