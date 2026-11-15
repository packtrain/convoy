"use client";

import { AppLink, type ProjectSettingsSection } from "@/lib/navigation";
import { useDevSettings } from "@/lib/dev-mode/use-dev-mode";
import { cn } from "@/lib/utils";
import { getProjectSettingsNavItems } from "./project-settings-navigation";
import { useProjectSettingsAccess } from "./use-project-settings-access";

export function ProjectSettingsDrawerContent({
  organizationSlug,
  projectAlias,
  activeSection = null,
  onSelect,
}: {
  organizationSlug: string;
  projectAlias: string;
  activeSection?: ProjectSettingsSection | null;
  onSelect: () => void;
}) {
  const devSettings = useDevSettings();
  const { canOpenSection } = useProjectSettingsAccess(organizationSlug, projectAlias);
  const items = getProjectSettingsNavItems({
    organizationSlug,
    projectAlias,
    activeSection,
    devSettings,
    canOpenSection,
  });

  return (
    <div className="space-y-3 p-4">
      <h2 className="px-1 text-sm font-semibold text-foreground">Settings</h2>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const itemClassName = cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
            item.disabled
              ? "cursor-not-allowed text-muted-foreground/60"
              : "cursor-pointer text-foreground hover:bg-muted active:bg-muted",
            item.isActive && "bg-muted font-medium text-foreground"
          );

          if (item.disabled) {
            return (
              <button
                key={item.id}
                type="button"
                disabled
                aria-disabled="true"
                className={itemClassName}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span>{item.label}</span>
              </button>
            );
          }

          return (
            <AppLink
              key={item.id}
              href={item.href}
              aria-current={item.isActive ? "page" : undefined}
              onClick={onSelect}
              className={itemClassName}
            >
              <Icon className="size-4 text-muted-foreground" />
              <span>{item.label}</span>
            </AppLink>
          );
        })}
      </div>
    </div>
  );
}
