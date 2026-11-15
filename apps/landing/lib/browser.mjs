// Uses the devcontainer's single Chromium when its config exists; otherwise Playwright's own lookup.
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

export async function launchChromium(options = {}) {
  const config = await readFile("/usr/local/share/playwright-cli/config.json", "utf8").then(JSON.parse, () => null);
  const executablePath = config?.browser?.launchOptions?.executablePath;
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...options });
}
