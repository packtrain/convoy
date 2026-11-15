import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectRole } from "@/lib/authz/roles";

export const PROJECT_ROLES = [
  {
    value: ProjectRole.PROJECT_ADMIN,
    label: "Project admin",
    description: "Full access, can manage members",
  },
  {
    value: ProjectRole.MEMBER,
    label: "Member",
    description: "Can create and edit tasks",
  },
  {
    value: ProjectRole.VIEWER,
    label: "Viewer",
    description: "Read-only access",
  },
] as const;

export type ProjectRoleValue = (typeof PROJECT_ROLES)[number]["value"];

export function getProjectRoleLabel(value: string): string {
  return PROJECT_ROLES.find((r) => r.value === value)?.label ?? value;
}

interface ProjectRoleSelectProps {
  value: string;
  onValueChange: (value: ProjectRoleValue) => void;
  disabled?: boolean;
  showDescriptions?: boolean;
  variant?: "default" | "badge";
  className?: string;
}

export function ProjectRoleSelect({
  value,
  onValueChange,
  disabled = false,
  showDescriptions = false,
  variant = "default",
  className,
}: ProjectRoleSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as ProjectRoleValue)}
      disabled={disabled}
    >
      <SelectTrigger
        variant={variant}
        className={
          className ?? (showDescriptions ? "w-full cursor-pointer" : variant === "badge" ? undefined : "w-34")
        }
      >
        <SelectValue>{getProjectRoleLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PROJECT_ROLES.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {showDescriptions ? (
              <div className="flex flex-col items-start p-2">
                <span>{role.label}</span>
                <span className="text-xs text-muted-foreground">
                  {role.description}
                </span>
              </div>
            ) : (
              role.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
