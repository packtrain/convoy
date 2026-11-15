import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { api } from "../../convex/_generated/api.js";
import { createConvexClient } from "../../lib/config/convex-client.js";
import { setProfile } from "../../lib/config/toml.js";
import { runConnect } from "../connect/workflow.js";
import { connectAuth } from "../../lib/config/credentials/resolution.js";
import { projectIdentity, requireProjectScope, requireVisibleProject, workerConfigSchema, type WorkerConfig } from "./validators.js";

export async function runProjectWorker(inputStream: Readable = process.stdin): Promise<void> {
  const shutdown = new AbortController();
  const onEnd = () => shutdown.abort();
  inputStream.once("end", onEnd);
  inputStream.once("error", onEnd);
  try {
    let config: WorkerConfig;
    try {
      const frame = await new Promise<string>((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        const fail = () => { cleanup(); reject(new Error("Invalid isolated worker configuration.")); };
        const data = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
          if (buffer.length > 65536) return fail();
          const newline = buffer.indexOf(10);
          if (newline < 0) return;
          cleanup();
          resolve(buffer.subarray(0, newline).toString("utf8"));
        };
        const cleanup = () => {
          inputStream.off("data", data);
          inputStream.off("end", fail);
          inputStream.off("error", fail);
        };
        inputStream.on("data", data);
        inputStream.once("end", fail);
        inputStream.once("error", fail);
      });
      config = workerConfigSchema.parse(JSON.parse(frame));
    } catch {
      throw new Error("Invalid isolated worker configuration. Reinstall matching CLI and launcher versions.");
    }
    if (shutdown.signal.aborted) return;
    // A shared worker runs as this account, so there is no Linux boundary to match. Spec: docs/specs/cli-shared-environments.md#execution
    const shared = config.mode === "shared";
    if (process.getuid?.() === 0 || (!shared && config.projectIdentity !== process.env.CONVOY_PROJECT_IDENTITY) ||
        projectIdentity(config.convexUrl, config.organizationId, config.projectId) !== config.projectIdentity) {
      throw new Error("Project identity does not match the Linux boundary.");
    }
    try {
      const client = createConvexClient({ url: config.convexUrl, apiKey: config.apiKey });
      try {
        (shared ? requireVisibleProject : requireProjectScope)(await client.query(api.apiKeys.core.currentScope, {}), config.organizationId, config.projectId);
      } finally { await client.close(); }
    } catch {
      throw new Error("Project scope verification failed. Check the project-scoped API key and backend currentScope query.");
    }
    if (shutdown.signal.aborted) return;
    if (!shared) {
      try {
        setProfile(config.profileKey, {
          name: config.profileKey, url: config.convexUrl, api_key: config.apiKey,
          project_id: config.projectId, paths: config.paths,
        });
      } catch {
        throw new Error("Cannot save the private project profile. Check private HOME permissions and config.toml.");
      }
    }
    try {
      const { mode: _mode, ...rest } = config;
      await runConnect({
        ...connectAuth(rest),
        nonInteractive: true, shutdownSignal: shutdown.signal, ...(shared ? { leaseHolder: "service" as const } : {}),
      });
    } catch {
      throw new Error("Isolated worker connection failed. See the preceding connection diagnostic.");
    }
  } finally {
    inputStream.off("end", onEnd);
    inputStream.off("error", onEnd);
    inputStream.pause();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runProjectWorker().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Isolated worker failed.");
  process.stdin.destroy();
  process.exitCode = 1;
});
