import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";

const script = new URL("./loopback-forward.js", import.meta.url).pathname;

function fakeBackend(port, reply) {
  const server = net.createServer((c) => c.end(reply)).listen(port, "127.0.0.1");
  return once(server, "listening").then(() => server);
}

async function read(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const c = net.connect(port, "127.0.0.1");
      let data = "";
      c.on("data", (d) => (data += d));
      await once(c, "end");
      return data;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`nothing answered on ${port}`);
}

test("a remapped loopback origin reaches the backend's own ports", async (t) => {
  const servers = await Promise.all([fakeBackend(3210, "cloud"), fakeBackend(3211, "site")]);
  const child = spawn("node", [script], {
    env: { ...process.env, CONVEX_CLOUD_ORIGIN: "http://127.0.0.1:3212", CONVEX_SITE_ORIGIN: "http://localhost:3213" },
    stdio: "inherit",
  });
  t.after(() => { child.kill(); servers.forEach((s) => s.close()); });
  assert.equal(await read(3212), "cloud");
  assert.equal(await read(3213), "site");
});

test("default and public origins forward nothing", async () => {
  const child = spawn("node", [script], {
    env: { ...process.env, CONVEX_CLOUD_ORIGIN: "http://127.0.0.1:3210", CONVEX_SITE_ORIGIN: "https://convex.example.com" },
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
});
