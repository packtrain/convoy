import type { DetectedCli, DetectedCliModel } from "../contracts.js";
import type { OpencodeAuth } from "../../../lib/config/credentials/validators.js";
import { connectOpencode, type OpencodeClientLike } from "./client.js";
import {
  getOpencodeServer,
  isOpencodeVersionSupported,
  opencodeVersion,
  shutdownOpencodeServer,
  type OpencodeServerHandle,
} from "./server.js";

/** Oldest OpenCode with the v2 server API surface the runner depends on. */
export const MINIMUM_OPENCODE_VERSION = "1.14.19";

/** Registration must not stall on a slow/hung inventory query. */
const INVENTORY_TIMEOUT_MS = 20_000;
/**
 * Budget for the advertised payload: what a picker can present and a catalog read
 * costs, above the largest measured real inventory (137 models). The server-side
 * ceiling is the parser's `MAX_STORED_CATALOG_MODELS` (OS-1721).
 */
export const MAX_ADVERTISED_MODELS = 150;

export type AvailableOpencodeCli = DetectedCli & {
  type: "opencode";
};

type OpencodeProviderInventory = Awaited<
  ReturnType<OpencodeClientLike["listProviders"]>
>;

/**
 * Hands the cap out one model at a time, cycling providers, so a large provider
 * cannot hide the others (a flat slice of 117/13/7 advertised bedrock only).
 * Providers under their share release the rest.
 */
function fairQuotas(sizes: number[], cap: number): number[] {
  if (sizes.length === 0) {
    return [];
  }

  const quotas = sizes.map(() => 0);
  let remaining = Math.min(
    cap,
    sizes.reduce((total, size) => total + size, 0),
  );
  for (let index = 0; remaining > 0; index = (index + 1) % sizes.length) {
    if (quotas[index] < sizes[index]) {
      quotas[index] += 1;
      remaining -= 1;
    }
  }
  return quotas;
}

/** Connected-provider models → advertised payload, capped per provider fairly. */
export function mapInventoryToAdvertisedModels(
  inventory: OpencodeProviderInventory,
): DetectedCliModel[] {
  const connected = new Set(inventory.connected);
  const byProvider = inventory.all
    .filter((provider) => connected.has(provider.id))
    .map((provider) =>
      Object.values(provider.models).map((model): DetectedCliModel => {
        const variants = Object.keys(model.variants ?? {});
        return {
          slug: `${provider.id}/${model.id}`,
          name: model.name,
          ...(variants.length > 0 ? { variants } : {}),
        };
      }),
    );

  const quotas = fairQuotas(
    byProvider.map((models) => models.length),
    MAX_ADVERTISED_MODELS,
  );
  // Grouped by provider, as the picker renders them.
  return byProvider.flatMap((models, index) => models.slice(0, quotas[index]));
}

export async function loadAdvertisedModels(deps?: {
  getServer?: (auth?: OpencodeAuth) => Promise<OpencodeServerHandle>;
  connect?: typeof connectOpencode;
  shutdownServer?: () => Promise<void>;
  auth?: OpencodeAuth;
}): Promise<DetectedCliModel[] | undefined> {
  const getServer = deps?.getServer ?? getOpencodeServer;
  const connect = deps?.connect ?? connectOpencode;
  const shutdownServer = deps?.shutdownServer ?? shutdownOpencodeServer;
  if (deps?.auth?.mode === "disabled") return [];

  try {
    const inventory = await Promise.race([
      (async () => {
        const server = await getServer(deps?.auth);
        const client = connect({
          baseUrl: server.url,
          directory: process.cwd(),
          password: server.password,
        });
        return client.listProviders();
      })(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("OpenCode inventory timed out")),
          INVENTORY_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    return mapInventoryToAdvertisedModels(inventory);
  } catch {
    // Fail soft: a CLI without inventory still registers (models unknown).
    return undefined;
  } finally {
    // Detection runs at agent startup for EVERY machine with opencode
    // installed — including users who never run OpenCode threads. Stop the
    // server started for this query; the first real OpenCode run restarts
    // the shared singleton lazily.
    await shutdownServer().catch(() => {});
  }
}

export async function detectOpencode(deps?: {
  getServer?: (auth?: OpencodeAuth) => Promise<OpencodeServerHandle>;
  connect?: typeof connectOpencode;
  shutdownServer?: () => Promise<void>;
  /** Managed keys: the inventory lists only the assigned providers (OS-2018). */
  auth?: OpencodeAuth;
}): Promise<AvailableOpencodeCli | null> {
  try {
    const version = await opencodeVersion();
    if (!version || !isOpencodeVersionSupported(version, MINIMUM_OPENCODE_VERSION)) {
      // Too-old installs are not advertised; the machine simply does not
      // offer the opencode runtime.
      return null;
    }

    // Advertise connected-provider models so the web composer can offer a
    // model picker (persisted server-side per profile for offline threads).
    // Uses a short-lived serve process, stopped right after the query.
    const models = await loadAdvertisedModels(deps);
    return { type: "opencode", version, ...(models ? { models } : {}) };
  } catch {
    return null;
  }
}
