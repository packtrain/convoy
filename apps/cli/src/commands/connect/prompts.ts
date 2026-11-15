import { ENV_THREAD_ID } from "../../lib/constants.js";

/** True when a person can answer connect's prompts: a TTY, outside an agent thread. See docs/specs/cli-sidecar-contract.md#without---json. */
export function canPromptToConnect(): boolean {
  return Boolean(process.stdin.isTTY) && !process.env[ENV_THREAD_ID];
}
