import type { ComponentType } from "react";

import type { RouteTarget } from "@/lib/navigation";

interface BaseSubpageNavigationItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: boolean;
}

export type SubpageNavigationItem =
  | (BaseSubpageNavigationItem & {
      href: RouteTarget | string;
      disabled?: false;
    })
  | (BaseSubpageNavigationItem & {
      disabled: true;
      href?: never;
    });
