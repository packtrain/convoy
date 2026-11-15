export type ClaudeCodeModelSlot =
  | "default"
  | "sonnet"
  | "sonnet-1m"
  | "sonnet-5-5"
  | "opus-5-5"
  | "opus-5"
  | "opus"
  | "opus-1m"
  | "opus-4-7"
  | "opus-4-7-1m"
  | "fable-5-2"
  | "fable-5-1"
  | "fable"
  | "haiku-5-5"
  | "haiku";

export type ClaudeCodeProvider =
  | "bedrock"
  | "mantle"
  | "anthropic"
  | "unknown";

const MODEL_SLOT_ORDER: ClaudeCodeModelSlot[] = [
  "default",
  "sonnet",
  "sonnet-1m",
  "sonnet-5-5",
  "opus-5-5",
  "opus-5",
  "opus",
  "opus-1m",
  "opus-4-7",
  "opus-4-7-1m",
  "fable-5-2",
  "fable-5-1",
  "fable",
  "haiku-5-5",
  "haiku",
];

export function isClaudeCodeModelSlot(
  value: unknown
): value is ClaudeCodeModelSlot {
  return MODEL_SLOT_ORDER.includes(value as ClaudeCodeModelSlot);
}
