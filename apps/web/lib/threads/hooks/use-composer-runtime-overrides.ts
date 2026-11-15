"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_FALLBACK_CLI_TYPE, type CliModel, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";

export interface ComposerRuntimeOverrides {
  cliType?: CliTypeSlug;
  cliModel?: CliModel;
  cliEffort?: string;
  mode?: string;
}

/**
 * The runtime-override slice of ThreadComposer `selectorsProps` for config
 * editors (agent automation, Workflow Prompt steps). Model/effort/mode picks
 * pin the displayed runtime alongside them so an override is never stored
 * without its runtime (OS-1512). `lockedCliType` instead hides the runtime
 * selector and reduces the overrides to mode only — for surfaces whose thread
 * settings live elsewhere (a single Lane's defaults, workflow-data-schema.md
 * → Lane and override rules); it still scopes the mode selector's options.
 */
export function useComposerRuntimeOverrides(
  value: ComposerRuntimeOverrides,
  onChange: (patch: Partial<ComposerRuntimeOverrides>) => void,
  lockedCliType?: CliTypeSlug
) {
  const locked = lockedCliType !== undefined;
  const displayedCliType = lockedCliType ?? value.cliType ?? DEFAULT_FALLBACK_CLI_TYPE;
  // Runtime + model/effort callbacks can fire in one menu click, before React
  // renders the new value; the ref keeps that click's runtime for the pin.
  const selectedCliTypeRef = useRef(displayedCliType);
  useEffect(() => {
    selectedCliTypeRef.current = displayedCliType;
  }, [displayedCliType]);
  const pin = (patch: Partial<ComposerRuntimeOverrides>) =>
    onChange(locked ? patch : { cliType: selectedCliTypeRef.current, ...patch });

  return {
    cliType: displayedCliType,
    mode: value.mode,
    cliModel: locked ? undefined : value.cliModel,
    cliEffort: locked ? undefined : value.cliEffort,
    hideRuntimeSelector: locked,
    onCliTypeChange: locked
      ? undefined
      : (cliType: CliTypeSlug) => {
          selectedCliTypeRef.current = cliType;
          // Model/effort remembered per CLI are meaningless across CLIs.
          onChange({ cliType, cliModel: undefined, cliEffort: undefined, mode: undefined });
        },
    onCliModelChange: locked ? undefined : (cliModel: CliModel) => pin({ cliModel }),
    onCliEffortChange: locked ? undefined : (cliEffort: string) => pin({ cliEffort }),
    onModeChange: (mode: string) => pin({ mode }),
  };
}
