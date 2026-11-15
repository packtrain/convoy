// Renders landing previews to PNGs for the root README, same harness as the preview tests.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { launchChromium } from "../lib/browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = fileURLToPath(new URL("../../../docs/assets/readme/", import.meta.url));
const fonts = "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Geist+Mono:wght@400..600&display=block";

const shots = [
  { name: "hero", module: "./components/product-preview", jsx: "<HeroPreview />", width: 1560 },
  { name: "kanban", module: "./components/product-preview/project-organization", jsx: '<ProjectOrganizationPreview initialMode="board" />', width: 1330 },
  { name: "workflows", module: "./components/product-preview", jsx: "<WorkflowPreview />", width: 900 },
  { name: "mobile", module: "./components/product-preview/remote-thread", jsx: "<RemoteThreadPreview />", width: 1000 },
  { name: "cli-tui", module: "./components/product-preview/environments", jsx: "<EnvironmentsPreview />", width: 1000 },
  { name: "architecture", module: "./components/product-preview/self-hosting", jsx: "<SelfHostingPreview />", width: 1000 },
];

await mkdir(out, { recursive: true });
const browser = await launchChromium();
try {
  for (const shot of shots) {
    const directory = await mkdtemp(join(tmpdir(), `convoy-readme-${shot.name}-`));
    try {
      const component = shot.jsx.match(/<(\w+)/)[1];
      await build({
        stdin: {
          contents: `import {createRoot} from 'react-dom/client'; import {${component}} from '${shot.module}'; createRoot(document.getElementById('root')).render(${shot.jsx});`,
          resolveDir: root,
          loader: "tsx",
        },
        bundle: true,
        outfile: join(directory, "preview.js"),
        jsx: "automatic",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
      });
      await writeFile(join(directory, "index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="${fonts}">
        <style>:root{--font-preview-sans:Inter;--font-preview-mono:'Geist Mono'}body{margin:0;padding:24px;background:#08080d;color:#f2f3f5;font-family:Inter,sans-serif}*{box-sizing:border-box}button,input,textarea{font:inherit}${await readFile(join(directory, "preview.css"), "utf8")}</style>
        <div id="root"></div><script>${await readFile(join(directory, "preview.js"), "utf8")}</script></html>`);
      const page = await browser.newPage({ viewport: { width: shot.width, height: 900 }, deviceScaleFactor: 2 });
      await page.goto(`file://${join(directory, "index.html")}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.locator("body").screenshot({ path: join(out, `${shot.name}.png`), animations: "disabled" });
      await page.close();
      console.log(`${shot.name}.png`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
