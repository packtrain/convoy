export type CodexModelSlot = string;

export function isCodexModelSlot(value: unknown): value is CodexModelSlot {
  return typeof value === "string" && value.trim().length > 0;
}

/** AWS run IDs: Mantle model IDs (`openai.*`), Bedrock Runtime inference profiles (`global.openai.*`). */
export function isCodexProviderModel(provider: "mantle" | "bedrock", model: string): boolean {
  return provider === "mantle" ? model.startsWith("openai.") : /^[a-z]+\.openai\./.test(model);
}
