import type { AgentKind } from "./backend";

/** UI metadata for the agent CLIs; runtime behavior lives in Rust (agents.rs). */
export interface AgentMeta {
  kind: AgentKind;
  title: string;
  initials: string;
  /** Manual install command shown when automatic install fails. */
  installCommand: string;
  /** Terminal command that signs the CLI in to its own account. */
  loginCommand: string;
  loginHint: string;
}

export const AGENT_CATALOG: AgentMeta[] = [
  {
    kind: "claude-code",
    title: "Claude Code",
    initials: "CC",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    loginCommand: "claude",
    loginHint: "Run it in Terminal and follow the sign-in prompt on first launch.",
  },
  {
    kind: "codex",
    title: "Codex",
    initials: "CX",
    installCommand: "npm install -g @openai/codex",
    loginCommand: "codex login",
    loginHint: "Run it in Terminal — it opens a browser sign-in.",
  },
  {
    kind: "opencode",
    title: "OpenCode",
    initials: "OC",
    installCommand: "curl -fsSL https://opencode.ai/install | bash",
    loginCommand: "opencode auth login",
    loginHint: "Run it in Terminal and pick your provider.",
  },
  {
    kind: "cursor",
    title: "Cursor CLI",
    initials: "CU",
    installCommand: "curl https://cursor.com/install -fsS | bash",
    loginCommand: "cursor-agent login",
    loginHint: "Run it in Terminal — it opens a browser sign-in.",
  },
];
