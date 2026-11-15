import { Badge } from "@/components/ui/badge";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import type { ProjectRole } from "@/lib/authz/roles";
import { getProjectRoleLabel } from "./project-role-select";

/** Header marker for a project role without write access; nothing while the role loads (docs/specs/read-only-viewer-ux.md). */
export function ViewOnlyBadge({ role }: { role: ProjectRole | null | undefined }) {
  if (!role || hasProjectPermission(role, ProjectPermission.TASK_UPDATE)) return null;

  return (
    <Badge
      variant="outline"
      className="shrink-0 text-muted-foreground"
      title={`You're a ${getProjectRoleLabel(role)} in this project. Ask a project admin for edit access.`}
    >
      View only
    </Badge>
  );
}
