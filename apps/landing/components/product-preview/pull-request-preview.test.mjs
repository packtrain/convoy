import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { launchChromium } from "../../lib/browser.mjs";

test("pull request preview switches tabs and keeps Reviewed marks local", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-pr-"));
  let browser;
  try {
    await build({
      stdin: { contents: `import {createRoot} from 'react-dom/client'; import {PullRequestPreview} from './components/product-preview/pull-request'; createRoot(document.getElementById('root')).render(<PullRequestPreview />);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx" },
      bundle: true, outfile: join(directory, "preview.js"), jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' },
    });
    await writeFile(join(directory, "index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px;background:#08080d}#root{max-width:1180px;margin:auto}${await readFile(join(directory, "preview.css"), "utf8")}</style><div id="root"></div><script>${await readFile(join(directory, "preview.js"), "utf8")}</script></html>`);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1220, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`file://${join(directory, "index.html")}`);
    const preview = page.getByRole("region", { name: "Pull request review preview" });
    await preview.waitFor();

    await t.test("the preview opens on the Guide tab", async () => {
      assert.equal(await preview.getByRole("tab", { selected: true }).textContent(), "Guide");
    });

    await t.test("Overview shows checks, GitHub checks, commits and Activity", async () => {
      await preview.getByRole("tab", { name: "Overview" }).click();
      for (const text of ["Pull request checks: 3/4", "GitHub checks: 3/3", "Commits: 3", "Outdated", "Up to date with main"]) {
        assert.equal(await preview.getByText(text, { exact: true }).count(), 1, text);
      }
      assert.equal(await preview.getByRole("region", { name: "Activity", exact: true }).getByRole("region", { name: "Activity composer" }).count(), 1);
      await preview.locator("summary").filter({ hasText: "Extra database requests" }).click();
      assert.ok(await preview.getByText(/reads the endpoint once more/).isVisible());
      await preview.screenshot({ path: "/tmp/pr-overview.png" });
    });

    await t.test("Guide pairs chapter notes with their diffs", async () => {
      await preview.getByRole("tab", { name: "Guide" }).click();
      const chapter = preview.getByRole("region", { name: "Retry schedule" });
      assert.equal(await chapter.getByText("01 / 02").count(), 1);
      assert.equal(await chapter.getByRole("checkbox", { name: "Reviewed" }).count(), 2);
      assert.equal(await preview.getByText(/^Product:/).count(), 1);
      await preview.screenshot({ path: "/tmp/pr-guide.png" });
    });

    await t.test("Reviewed marks carry over between Guide and Diff", async () => {
      const chapter = preview.getByRole("region", { name: "Retry schedule" });
      await chapter.getByRole("checkbox", { name: "Reviewed" }).first().check();
      assert.equal(await chapter.getByLabel("Reviewed", { exact: true }).locator("visible=true").count(), 3, "file list marks the reviewed file");
      await preview.getByRole("tab", { name: "Diff" }).click();
      const boxes = preview.getByRole("checkbox", { name: "Reviewed" });
      assert.equal(await boxes.count(), 3);
      assert.equal(await boxes.first().isChecked(), true);
      assert.equal(await boxes.nth(1).isChecked(), false);
    });

    for (const width of [390, 320]) {
      await t.test(`no page overflow at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        for (const tab of ["Overview", "Guide"]) {
          await preview.getByRole("tab", { name: tab }).click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} fits`);
          await preview.screenshot({ path: `/tmp/pr-${tab.toLowerCase()}-${width}.png` });
        }
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
