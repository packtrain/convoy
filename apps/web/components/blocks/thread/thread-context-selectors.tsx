"use client";

import type { WorkingDirectorySelectorProfile } from "./working-directory-selector";
import { CliTypeSelector } from "./cli-type-selector";
import { ModeSelector } from "./mode-selector";
import type { ThreadAgentSelectorAgent } from "./thread-agent-selector";
import type { CliModel, CliTypeSlug } from "@/lib/threads/types";
import type { BaseRefSelection } from "@/lib/threads/base-ref-selection";
import { useCliFavoriteCombos } from "@/lib/threads/hooks/use-cli-favorite-combos";

/**
 * The thread composer's context configuration. ThreadComposer renders the
 * working directory, workspace/base-ref, and agent selectors in the context
 * bar above the input on every surface (single layout, OS-1377); this
 * component renders only the footer toolbar selectors: the labeled CLI/model
 * selector and the mode selector.
 */
interface ThreadContextSelectorsProps {
  profiles: WorkingDirectorySelectorProfile[];
  profileId: string;
  pathId: string;
  cliType: CliTypeSlug;
  mode: string | undefined;
  cliModel: CliModel | undefined;
  cliEffort?: string;
  disabled?: boolean;
  onPathChange?: (profileId: string, pathId: string) => void;
  onCliTypeChange?: (value: CliTypeSlug) => void;
  onCliModelChange?: (value: CliModel) => void;
  onCliEffortChange?: (value: string) => void;
  onModeChange: (value: string) => void;
  /**
   * New-thread composers only (OS-1138): the persona selector. Follow-up
   * composers never pass `onProjectAgentChange` — the binding is immutable
   * after creation. Rendered in ThreadComposer's context bar above the input.
   */
  projectAgents?: ThreadAgentSelectorAgent[];
  projectAgentId?: string;
  onProjectAgentChange?: (projectAgentId: string | undefined) => void;
  /**
   * Assignment automation (OS-1138): the assigned agent is preselected and
   * fixed — the pill renders normally but can't be changed.
   */
  projectAgentLocked?: boolean;
  /**
   * New-thread composers only: worktree/base-ref selection. Rendered in
   * ThreadComposer's context bar above the input (OS-1218).
   */
  baseRef?: BaseRefSelection;
  onBaseRefChange?: (value: BaseRefSelection | undefined) => void;
  lockAgentContext?: boolean;
  /**
   * Hides the CLI/model selector entirely. Workflow single-Lane Prompt steps
   * pass it: the thread's runtime, model, and effort live on the Lane, so the
   * composer edits only the mode (workflow-data-schema.md → Lane and override
   * rules). `cliType` still scopes the mode selector's options.
   */
  hideRuntimeSelector?: boolean;
  /**
   * Hides the working-directory (and base-ref) selectors in the context bar.
   * Config editors (agent automation) pass it because agents store no
   * user-specific profile/path (model options fall back to the runtime
   * registry).
   */
  hideWorkingDirectory?: boolean;
  /** Icon-only CLI/model and mode triggers; labels stay in title/aria-label (OS-2151). */
  compact?: boolean;
}

const NOOP_CLI_CHANGE = () => {};
const NOOP_MODEL_CHANGE = () => {};
const NOOP_EFFORT_CHANGE = () => {};

export function ThreadContextSelectors({
  profiles,
  profileId,
  cliType,
  mode,
  cliModel,
  cliEffort,
  disabled = false,
  onCliTypeChange,
  onCliModelChange,
  onCliEffortChange,
  onModeChange,
  lockAgentContext = false,
  hideRuntimeSelector = false,
  compact = false,
}: ThreadContextSelectorsProps) {
  const { favoriteCombos, toggleFavoriteCombo } = useCliFavoriteCombos();
  const handleCliTypeChange = onCliTypeChange ?? NOOP_CLI_CHANGE;
  const handleCliModelChange = onCliModelChange ?? NOOP_MODEL_CHANGE;
  const handleCliEffortChange = onCliEffortChange ?? NOOP_EFFORT_CHANGE;
  const selectedProfile = profiles.find((profile) => profile._id === profileId);

  return (
    <>
      {hideRuntimeSelector ? null : (
        <CliTypeSelector
          value={cliType}
          onChange={handleCliTypeChange}
          cliModel={cliModel}
          cliEffort={cliEffort}
          availableClis={selectedProfile?.availableClis}
          onCliModelChange={handleCliModelChange}
          onCliEffortChange={handleCliEffortChange}
          allowedCliTypes={lockAgentContext ? [cliType] : undefined}
          disabled={disabled}
          favoriteCombos={favoriteCombos}
          onToggleFavoriteCombo={toggleFavoriteCombo}
          compact={compact}
        />
      )}
      <ModeSelector cliType={cliType} value={mode} onChange={onModeChange} disabled={disabled} compact={compact} />
    </>
  );
}
