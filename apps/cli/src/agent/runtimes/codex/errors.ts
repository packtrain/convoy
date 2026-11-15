import { stripVTControlCharacters } from "node:util";
import type { Readable } from "node:stream";
import type { CodexAuth } from "../../../lib/config/credentials/validators.js";
import type { CodexProviderKey } from "../../../lib/config/types.js";
import { redactAuth } from "../../../lib/config/convex-client.js";
import { codexProviderLabel, codexSecret } from "./auth.js";

const MAX_LINE = 8192;
const MAX_DIAGNOSTIC = 6144;

/** Diagnostic text only, never agent output. Redact before truncating or logging. */
export function sanitizeCodexDiagnostic(value: string, secret?: string): string {
  return stripVTControlCharacters(redactAuth(value, secret))
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/\b(Bearer|Basic)\s+[^\s"'\\,;]+/gi, "$1 [redacted]")
    .replace(/((?:["']?)(?:api[ _-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, "$1[redacted]")
    // eslint-disable-next-line no-control-regex -- diagnostics must not carry terminal controls
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .slice(0, MAX_DIAGNOSTIC);
}

/** Drop oversized lines whole so truncation cannot expose part of a secret. */
export function collectCodexDiagnostics(
  stream: Readable,
  secret: string | undefined,
  log: (line: string) => void
): () => string {
  const tail: string[] = [];
  let pending = "";
  let oversized = false;
  const flush = () => {
    const line = oversized ? "[oversized diagnostic line omitted]" : sanitizeCodexDiagnostic(pending.trim(), secret);
    pending = "";
    oversized = false;
    if (!line) return;
    log(line);
    tail.push(line.slice(0, 512));
    if (tail.length > 12) tail.shift();
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const [index, part] of chunk.split("\n").entries()) {
      if (index > 0) flush();
      if (oversized) continue;
      if (pending.length + part.length > MAX_LINE) {
        pending = "";
        oversized = true;
      } else pending += part;
    }
  });
  stream.on("end", flush);
  return () => tail.join(" | ");
}

/** AWS failures never point at native login; a 403 can be IAM or model access, not the token. */
function formatAwsFailure(clean: string, provider: CodexProviderKey): string {
  const label = codexProviderLabel(provider);
  if (/\b401\b|invalid bearer token|unauthorized|security token.*invalid/i.test(clean)) {
    return `${clean} ${label} rejected the credentials. Check or replace the token on this profile's Codex key (convoy keys list), then reconnect.`;
  }
  if (/\b403\b|access ?denied|not authorized/i.test(clean)) {
    return `${clean} AWS denied the request. The token, IAM permissions or model access in ${provider.region} can each cause this.`;
  }
  if (/\b404\b|model.*(?:not found|not available|unsupported|does not exist)/i.test(clean)) {
    return `${clean} The model may not be available on ${label} in ${provider.region}. Pick another model or Region.`;
  }
  return clean;
}

export function formatCodexFailure(message: string, auth?: CodexAuth, provider?: CodexProviderKey): string {
  const clean = sanitizeCodexDiagnostic(message, codexSecret(auth, provider));
  if (provider) return formatAwsFailure(clean, provider);
  if (!/\b(?:not authenticated|not logged in|authentication required|missing authentication|invalid api key|incorrect api key|authentication failed|refresh token (?:has )?expired)\b/i.test(clean)) return clean;
  if (auth?.mode === "managed") {
    return `${clean} Codex authentication failed. Check or replace the managed OpenAI API key assigned to this project's Codex runtime, then reload the project and retry.`;
  }
  return `${clean} Codex authentication failed. For an isolated project, pause its connection and open its private shell with convoy project shell <project>. Add --env <environment> for a managed container. Run codex login --device-auth in the runtime's HOME, then reload the project and retry. Alternatively, assign a managed OpenAI API key to this project's Codex runtime.`;
}
