import { Command, InvalidArgumentError } from "commander";
import { ServiceClient, serviceEndpoint } from "./client.js";
import { servicePaths } from "./paths.js";
import { printServiceEvent, printRunResult } from "./formatters.js";
import { serviceBridge } from "./bridge.js";
import { exitAfterFlush } from "../../lib/connect-events.js";
import { ServiceOutput, ServiceOutputError } from "./output.js";
import { requestSchema } from "./validators.js";
import { ServiceTransportError } from "./errors.js";

function integerArgument(value: string, min: number, max: number, message: string): number {
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) throw new InvalidArgumentError(message);
  return number;
}

async function report(action: () => Promise<void>) {
  try { await action(); } catch (error) { console.error(error instanceof Error ? error.message : "Service client failed."); process.exitCode = 1; if (error instanceof ServiceOutputError) exitAfterFlush(1); }
}

export const attachCommand = new Command("attach").description("Watch the local service; Ctrl+C detaches without stopping agents")
  .option("--profile <key>", "Filter service events by registered profile")
  .option("--json", "Print framed NDJSON")
  .action((options: { profile?: string; json?: boolean }) => report(async () => {
    let stopped = false;
    let client: ServiceClient | undefined;
    const output = new ServiceOutput(error => client?.close(error));
    const stop = () => { stopped = true; client?.close(); };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
    let epoch: string | undefined, after: number | undefined, connected = false;
    try {
      while (!stopped) {
        try {
          client = await ServiceClient.open(serviceEndpoint());
          connected = true;
          if (stopped) { client.close(); break; }
          await client.subscribe({ profile: options.profile, epoch, after }, event => {
            epoch = event.epoch; after = event.cursor; printServiceEvent(event, options.json, output.write);
          });
          const error = await client.closed;
          if (output.error) throw output.error;
          if (error && !stopped) console.error(`${error.message} Reconnecting…`);
        } catch (error) {
          if (stopped) break;
          // Invalid selection and incompatible protocol need user correction.
          // A transport that never connected (SSH auth, host key, missing CLI) needs user correction too.
          if (error instanceof ServiceTransportError && !connected) throw error;
          if (error instanceof Error && /Unknown service profile|Invalid service response|Negotiate|Incompatible running service|Terminal output/.test(error.message)) throw error;
          console.error(`${error instanceof ServiceTransportError ? error.message : "Service unavailable."} Waiting to reconnect; Ctrl+C detaches.`);
        } finally { client?.close(); }
        if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await output.flush();
    } finally { output.dispose(); for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop); }
  }));

export function addServiceClients(command: Command): void {
  command.command("bridge").description("Internal validated stdin/stdout transport to the local service")
    .action(() => report(() => serviceBridge(servicePaths(undefined, false).socket)));
  command.command("outcome <requestId>").requiredOption("--epoch <epoch>", "Service epoch reported with the request")
    .action((requestId: string, options: { epoch: string }) => report(async () => {
      const client = await ServiceClient.open(serviceEndpoint());
      try { printRunResult(await client.request({ op: "outcome", requestId, epoch: options.epoch }), true); }
      finally { client.close(); }
    }));
  const runs = command.command("runs").description("Inspect execution threads and their runs through the service");
  for (const name of ["list", "get", "history", "logs", "cancel"] as const) {
    const sub = runs.command(name === "list" ? name : `${name} <threadId>`)
      .requiredOption("--profile <key>", "Registered execution profile")
      .option("--json", "Print structured output");
    if (name === "list" || name === "history") sub.option("--cursor <cursor>", "Backend page cursor").option("--limit <n>", "Page size, 1 to 50", value => integerArgument(value, 1, 50, "Page size must be an integer from 1 to 50."), 20);
    if (name === "logs") sub.requiredOption("--message <id>", "Assistant message ID from history").option("--after <order>", "Resume after this stored chunk order", value => integerArgument(value, -1, Number.MAX_SAFE_INTEGER, "Chunk order must be a safe integer of -1 or greater."), -1).option("-f, --follow", "Follow stored run events; Ctrl+C detaches");
    if (name === "cancel") sub.requiredOption("--run <id>", "Exact active run ID from history").option("--request-id <id>", "Stable request ID for outcome lookup");
    sub.action((...args: unknown[]) => report(async () => {
      const threadId = name === "list" ? undefined : args[0] as string;
      const options = args[name === "list" ? 0 : 1] as { profile: string; json?: boolean; cursor?: string; limit?: number; message?: string; after?: number; follow?: boolean; run?: string; requestId?: string };
      const parsed = requestSchema.safeParse({ v: 1, id: options.requestId ?? "validate", op: `runs.${name}`, profile: options.profile, threadId,
        pageCursor: options.cursor, limit: options.limit, messageId: options.message,
        chunkAfter: options.after, runId: options.run });
      if (!parsed.success) throw new Error(`Invalid ${parsed.error.issues[0]?.path.join(".") || "run command"}: ${parsed.error.issues[0]?.message}.`);
      const request = parsed.data;
      const client = await ServiceClient.open(serviceEndpoint());
      const output = new ServiceOutput(error => client.close(error));
      let stopped = false;
      let pollDelay = 1000;
      const stop = () => { stopped = true; client.close(); };
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
      try {
        do {
          const response = await client.request(request, options.requestId);
          if (name !== "logs") { printRunResult(response.result, options.json, output.write); break; }
          const result = response.result as { page: Array<{ order: number; eventJson: string; truncated: boolean }>; cursor: number; hasMore: boolean; run: { status: string } };
          for (const row of result.page) printRunResult(options.json ? row : JSON.parse(row.eventJson), options.json, output.write);
          await output.flush();
          request.chunkAfter = result.cursor;
          if (result.page.length) pollDelay = 1000;
          if (result.hasMore) continue;
          if (!options.follow || result.run.status !== "streaming") break;
          await new Promise(resolve => setTimeout(resolve, pollDelay));
          if (!result.page.length) pollDelay = Math.min(5000, pollDelay * 2);
        } while (!stopped);
        await output.flush();
      } catch (error) { if (!stopped) throw error; }
      finally { output.dispose(); client.close(); for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop); }
    }));
  }
}
