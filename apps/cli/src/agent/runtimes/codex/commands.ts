/**
* Codex slash-command discovery (OS-1582). The app-server advertises no inventory in its event
* stream, so the runner emits one as a synthetic `convoy.commands` chunk — the same mechanism
* OpenCode and Cursor use.
*
* Only commands Convoy can execute are advertised: discovery feeds the composer autocomplete,
* which is what marks a message as a runtime command, so advertising an unrunnable one sends it
* to the model as prose — which it answers as if it had run (the OS-1582 bug). Custom prompts
* need template expansion and wait for OS-1119.
*/

/** Codex built-ins backed by a dedicated app-server RPC. */
export const CODEX_APP_SERVER_COMMANDS = ["compact", "usage", "goal"] as const;

/** Composer details for commands whose name alone does not say how to use them. */
const COMMAND_DETAILS: Partial<Record<CodexRuntimeCommand, { description: string; argumentHint: string }>> = {
  goal: { description: "Keep working until a condition holds", argumentHint: "[objective | pause | resume | clear]" },
};

export type CodexRuntimeCommand = (typeof CODEX_APP_SERVER_COMMANDS)[number];

export function isCodexAppServerCommand(
  command: string,
): command is CodexRuntimeCommand {
  return (CODEX_APP_SERVER_COMMANDS as readonly string[]).includes(command);
}

/**
 * Inventory advertised for a run. The exec transport (`codex exec --json`)
 * has no per-thread RPC channel and therefore cannot execute any of these,
 * so it advertises nothing — keeping the composer from offering a command
 * that would silently degrade to prose on that transport.
 */
export function discoverCodexCommands(options: {
  appServer: boolean;
}): Array<string | { name: string; description: string; argumentHint: string }> {
  if (!options.appServer) return [];
  return CODEX_APP_SERVER_COMMANDS.map((name) => {
    const details = COMMAND_DETAILS[name];
    return details ? { name, ...details } : name;
  });
}
