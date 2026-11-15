import type { ClaudeMethod, InitScope, InitTarget, TargetInstallResult } from "../types.js";

export interface InitLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ConfigureMcpInput {
  baseDir: string;
  mcpUrl: string;
  apiKey: string;
  force?: boolean;
  confirmOverwrite: (message: string) => Promise<boolean>;
  log: InitLogger;
}

export interface InstallSkillInput {
  baseDir: string;
  scope: InitScope;
  marketplaceDir: string;
  force?: boolean;
  confirmOverwrite?: (message: string) => Promise<boolean>;
  preparedDestinations?: Set<string>;
  // Optional driver-specific options. Non-Claude drivers can ignore this.
  claudeMethods?: ClaudeMethod[];
}

export interface InitTargetDriver {
  id: InitTarget;
  label: string;
  configureMcp(input: ConfigureMcpInput): Promise<void>;
  installSkill(input: InstallSkillInput): Promise<TargetInstallResult[]>;
}
