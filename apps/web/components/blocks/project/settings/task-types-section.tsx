"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/custom/color-picker";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { hasOrgPermission, OrgPermission } from "@/lib/authz/permissions";
import { DEFAULT_COLOR_PALETTE } from "@/lib/colors/palette";
import {
  BUILT_IN_TASK_TYPES,
  normalizeTaskTypeKey,
} from "@/lib/tasks/task-types";

interface TaskTypesSectionProps {
  organizationId: Id<"organizations">;
}


export function TaskTypesSection({ organizationId }: TaskTypesSectionProps) {
  const myRole = useQuery(api.organizations.members.getMyRole, { organizationId });
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(DEFAULT_COLOR_PALETTE[0]);
  // No task-type permission yet; org owners and admins manage org-wide settings.
  const canManage = hasOrgPermission(myRole, OrgPermission.ORG_UPDATE);

  const keyPreview = useMemo(() => normalizeTaskTypeKey(name), [name]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Manage organization-wide task types.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-1">
          {BUILT_IN_TASK_TYPES.map((taskType) => (
            <div
              key={taskType.key}
              className="rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <TaskType taskType={taskType} variant="icon" className="shrink-0" />
                <span className="truncate text-sm text-foreground">{taskType.name}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Create</h3>
            <Badge variant="secondary" className="text-xs">Soon</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Custom task types render as a colored dot in selectors and search results.
          </p>

          {myRole !== undefined && !canManage ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <Lock className="size-4" />
              Only organization admins can manage task types.
            </div>
          ) : null}

          <div className="flex flex-wrap items-start gap-3">
            <div className="pt-6">
              <ColorPicker
                value={color}
                onChange={setColor}
                allowEmpty={false}
                disabled
              />
            </div>
            <div className="min-w-[220px] flex-1 space-y-2">
              <Label htmlFor="task-type-name">Name</Label>
              <Input
                id="task-type-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Infrastructure chore"
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Key: <code>{keyPreview || "infrastructure-chore"}</code>
              </p>
            </div>
            <div className="pt-6">
              <Button
                type="button"
                disabled
                className="cursor-not-allowed"
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
