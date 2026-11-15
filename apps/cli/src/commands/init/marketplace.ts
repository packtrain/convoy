import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the bundled marketplace directory (contains marketplace.json + plugins).
 *
 * Expected layout:
 *   Built (npm):  dist/src/commands/init/marketplace.js  ->  ../../../marketplace  ->  dist/marketplace/
 *   Dev (tsx):    src/commands/init/marketplace.ts       ->  ../../../../../plugins
 */
export function getMarketplaceDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(__dirname, "../../../marketplace"),
    path.resolve(__dirname, "../../../../../plugins"),
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.existsSync(path.join(candidate, ".claude-plugin/marketplace.json"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Bundled marketplace directory not found. Searched: ${candidates.join(", ")}`
  );
}
