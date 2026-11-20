import type { JsonRpc } from "../../json-rpc.js";
import { parseQuotaBuckets, readQuotaAccount } from "./parsers.js";
import type { QuotaBucket, QuotaReport } from "./validators.js";

/** Account-scoped state exists only for this runner execution. */
export function createCodexUsage() {
  let accountRevision = 0;
  let authMode: unknown;
  let updates: Map<string, QuotaBucket> | undefined;

  return {
    onNotification(method: string, params: Record<string, unknown>): void {
      if (method === "account/updated") {
        if (params.authMode !== undefined) {
          if (authMode !== undefined && authMode !== params.authMode) {
            accountRevision++;
            updates?.clear();
          }
          authMode = params.authMode;
        }
      } else if (method === "account/login/completed" && params.success === true) {
        accountRevision++;
        updates?.clear();
      } else if (method === "account/rateLimits/updated" && updates) {
        for (const bucket of parseQuotaBuckets(params)) updates.set(bucket.id, bucket);
      }
    },

    async read(rpc: JsonRpc): Promise<QuotaReport> {
      const revision = accountRevision;
      updates = new Map();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async () => {
            const before = readQuotaAccount(await rpc.request("account/read", { refreshToken: false }));
            // Startup may announce the already-signed-in account during account/read.
            if (authMode === undefined) authMode = "chatgpt";
            const result = await rpc.request("account/rateLimits/read");
            const after = readQuotaAccount(await rpc.request("account/read", { refreshToken: false }));
            if (revision !== accountRevision || before.identity !== after.identity) {
              throw new Error("The Codex account changed during refresh. Run /usage again for the new account.");
            }
            const buckets = new Map(parseQuotaBuckets(result).map(bucket => [bucket.id, bucket]));
            for (const [id, bucket] of updates ?? []) buckets.set(id, bucket);
            if (![...buckets.values()].some(bucket => bucket.windows.length > 0)) {
              throw new Error("Codex did not report account quota windows. Usage is unavailable for this account.");
            }
            return { account: after.label, buckets: [...buckets.values()], refreshedAt: Date.now() };
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Codex account usage refresh timed out. Check the runner connection and try /usage again.")), 15_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        updates = undefined;
      }
    },
  };
}
