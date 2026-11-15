import type React from "react";
import type { LucideIcon } from "lucide-react";
import type {
  AvailableCli as AvailableCliInfo,
  CliModel,
} from "@/convex/lib/contracts/validators";
import type {
  CliRuntimeEffortOption,
  CliRuntimeModelOption,
  CliRuntimeSlug,
} from "@/convex/cli/lib/runtimes/contracts";

export type CliTypeSlug = CliRuntimeSlug;
export type { AvailableCliInfo, CliModel };

export type CliIconComponent = React.ComponentType<{ className?: string }>;
export type CliModelOption = CliRuntimeModelOption;

export type CliModeDefinition = {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

/**
 * A provider section inside a runtime's model list. Labeled groups render
 * as nested submenus (provider icon + name on the trigger, models inside);
 * groups without a label render as plain items (e.g. the machine-default
 * slot above the sections). `effortOptions` is the group's Reasoning
 * section, shown above the models.
 */
export type CliModelGroup = {
  key: string;
  label?: string;
  icon?: CliIconComponent;
  options: CliModelOption[];
  effortOptions?: CliRuntimeEffortOption[];
};

export type CliRuntimeUiDefinition = {
  type: CliTypeSlug;
  icon?: CliIconComponent;
  availableInSelector?: boolean;
  modes?: CliModeDefinition[];
  getModelTooltip?: (model: CliModel | undefined) => string | undefined;
  /**
   * Group model options into provider sections (icon + provider name on the
   * header, no icons on the models). Useful when one runtime's catalog
   * spans providers (Cursor); single-vendor runtimes omit it and render a
   * flat list.
   */
  groupModelOptions?: (options: CliModelOption[]) => CliModelGroup[];
  /** Hosted provider shown above the model list, with its capability limits. */
  getProviderNotice?: (availableClis?: readonly AvailableCliInfo[]) => CliProviderNotice | undefined;
};

export type CliProviderNotice = {
  label: string;
  limits: string;
};
