import type { Binding } from "../../../lib/config/credentials/validators.js";

export type AccessRuntime = "codex" | "claude-code";
export type AccessState = {
  draft: Partial<Record<AccessRuntime, Binding>>;
  saved: Partial<Record<AccessRuntime, Binding>>;
  reloadPending: boolean;
};
export type OnboardingSession = {
  origin?: "actions";
  profile: string;
  message: string;
  step: "access" | "result";
  access: AccessState;
};
