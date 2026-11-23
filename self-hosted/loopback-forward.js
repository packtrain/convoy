// Runs inside the backend container. Convex Auth fetches its JWKS from CONVEX_CLOUD_ORIGIN, so a
// loopback origin on a remapped port must answer here too (docs/specs/auth-adapters.md#self-hosted-ports).
const net = require("node:net");

const loopback = ["127.0.0.1", "localhost", "[::1]"];
for (const [origin, port] of [[process.env.CONVEX_CLOUD_ORIGIN, 3210], [process.env.CONVEX_SITE_ORIGIN, 3211]]) {
  const url = new URL(origin);
  const published = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!loopback.includes(url.hostname) || published === port) continue;
  net.createServer((client) => {
    const backend = net.connect(port, "127.0.0.1");
    client.pipe(backend).pipe(client);
    client.on("error", () => backend.destroy());
    backend.on("error", () => client.destroy());
  }).listen(published);
}
