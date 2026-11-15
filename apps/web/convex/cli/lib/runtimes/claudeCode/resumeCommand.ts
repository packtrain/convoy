export function buildClaudeCodeResumeCommand(continuationId: string): string {
  return `claude --resume ${continuationId}`;
}
