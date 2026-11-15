import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runService } from "../workflow.js";

const directory = process.argv[2];
const service = await runService({ directory, socket: join(directory, "control.sock") }, [{
  key: "a", identity: "a".repeat(64), config: { convexUrl: "https://example.com", apiKey: "fixture-secret",
    projectId: "p", organizationId: "o", profileKey: "a", concurrency: undefined,
    partialStreaming: undefined, isolated: undefined, jsonEvents: true },
}], () => {
  const child = spawn(process.execPath, ["-e", `
    const fs = require('node:fs');
    process.stdin.resume();
    process.stdin.on('end', () => { fs.writeFileSync(process.argv[1], 'cleaned'); process.exit(0); });
    console.log(JSON.stringify({v:1,event:'status',status:'online'}));
  `, join(directory, "cleaned")], { stdio: ["pipe", "pipe", "pipe"] });
  writeFileSync(join(directory, "worker.pid"), String(child.pid));
  return child;
});
console.log("ready");
await service.done;
await new Promise((resolve) => setImmediate(resolve));
await service.close();
