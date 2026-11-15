import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { launchChromium } from "../../lib/browser.mjs";

test("checks expose evidence, preserve results and keep run actions inert", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-checks-"));
  let browser;
  try {
    await build({
      stdin: { contents: `import {createRoot} from 'react-dom/client'; import {ChecksPreview,TaskChecksPreview} from './components/product-preview/checks'; createRoot(document.getElementById('root')).render(<><ChecksPreview /><div style={{marginTop:40,maxWidth:340}}><TaskChecksPreview /></div></>);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx" },
      bundle: true, outfile: join(directory, "preview.js"), jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' },
    });
    await writeFile(join(directory, "index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px;background:#08080d}#root{max-width:780px;margin:auto}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 850, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`file://${join(directory, "index.html")}`);
    const panel = page.getByRole("region", { name: "Checks and evidence preview" });
    await panel.waitFor();
    await t.test("the active sidebar tab is named Checks, like the product", async () => {
      assert.equal(await panel.getByText("Evidence", { exact: true }).count(), 0);
      assert.ok(await panel.getByText(/^ChangesTasksChecksNS-142$/).count() > 0);
    });
    await t.test("only Mobile layout has an Added badge", async () => {
      assert.equal(await panel.getByText("Added", { exact: true }).count(), 1);
      assert.equal(await panel.locator("summary > span[title]").last().textContent(), "Mobile layout");
    });
    await t.test("long check labels stay on one line", async () => {
      const label = panel.locator("summary > span").filter({ hasText: "Regression test fails" });
      assert.ok(await label.evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) + 1));
    });
    await t.test("Run checks lists checklist choices directly", async () => {
      const trigger = panel.locator("summary").filter({ hasText: "Run checks" });
      await trigger.click();
      assert.equal(await panel.getByRole("menuitemradio").count(), 5);
      await trigger.click();
    });
    assert.equal(await panel.getByRole("heading", { name: "Other files", exact: true }).count(), 1, "Checks panel includes Other files like the product");
    assert.equal(await panel.locator('[data-thread-crop]').count(), 1, "thread crop sits beside evidence");
    assert.match(await panel.evaluate(element => getComputedStyle(element).fontFamily), /Arial|Inter/);
    assert.equal(await panel.getByLabel("3 of 6 checks passed").count(), 1);
    for (const status of ["Passed", "Warning", "Failed", "Pending", "Not performed"]) {
      assert.ok(await panel.locator(`svg[aria-label="${status}"]`).count() >= 1);
    }
    await panel.locator("summary").filter({ hasText: "All tests pass" }).click();
    await panel.locator("summary").filter({ hasText: "test-results.log" }).click();
    assert.equal(await panel.locator("pre:visible").textContent(), "PASS delivery.test.ts\n42 passed · 0 failed · 4.2s\nIntegration suite: staging credentials unavailable");
    const run = panel.locator("summary").filter({ hasText: "Run checks" });
    const beforeRun = await panel.innerText();
    await run.focus();
    await page.keyboard.press("Enter");
    await panel.getByRole("menuitem", { name: "Pending and failed" }).click();
    await t.test("Pending and failed leaves the preview unchanged", async () => { assert.equal(await panel.innerText(), beforeRun); });
    assert(await run.evaluate(element => element === document.activeElement));
    await run.click();
    await panel.getByRole("menuitem", { name: "All checks", exact: true }).click();
    await t.test("All checks leaves the preview unchanged", async () => { assert.equal(await panel.innerText(), beforeRun); });
    await run.click();
    await page.keyboard.press("Escape");
    assert.equal(await panel.getByRole("menuitem", { name: "All checks", exact: true }).isVisible(), false);
    for (const checklist of ["Bug fix", "No checks"]) {
      await run.click();
      await panel.getByRole("menuitemradio", { name: checklist, exact: true }).click();
      await page.keyboard.press("Escape");
      assert.equal(await panel.getByLabel("3 of 5 checks passed").count(), 1);
      assert.equal(await panel.getByText("Add screenshot evidence", { exact: true }).count(), 0);
      assert.equal(await panel.getByText("All tests pass", { exact: true }).count(), 1);
      await run.click();
      await panel.getByRole("menuitem", { name: "Pending and failed" }).click();
      assert.equal(await panel.getByText(/^Run pending and failed checks for/).count(), 0);
    }
    await run.click();
    await panel.getByRole("menuitemradio", { name: "Feature Default", exact: true }).click();
    await page.keyboard.press("Escape");
    await panel.locator("summary").filter({ hasText: "All tests pass" }).click();
    const compact = page.getByRole("region", { name: "Task checks", exact: true });
    assert.equal(await compact.getByRole("heading", { name: "Checks 3/6" }).count(), 1);
    assert.equal(await compact.getByText("Run checks").count(), 0);
    assert.equal(await panel.getByText("Interactive demo", { exact: true }).count(), 0);
    assert.equal(await panel.getByText("Results your team can inspect", { exact: true }).count(), 0);
    assert.equal(await panel.getByText("Added", { exact: true }).count(), 1);
    assert.equal(await panel.locator("summary").filter({ hasText: "simulated-checks.md" }).count(), 1);
    const crop = panel.locator('[data-thread-crop]');
    assert.match(await crop.evaluate(element => getComputedStyle(element).maskImage), /linear-gradient/);
    const sidebar = panel.locator('[data-thread-crop] + div');
    assert.ok((await sidebar.boundingBox()).width <= 480, "Evidence sidebar stays at most 480px wide");
    assert.ok((await crop.boundingBox()).width >= 250, "thread gets the remaining scene width");
    await panel.screenshot({ path: "/tmp/checks-desktop.png" });
    await run.focus();
    await page.keyboard.press("ArrowDown");
    assert(await panel.getByRole("menuitem", { name: "Pending and failed" }).evaluate(element => element === document.activeElement));
    await page.keyboard.press("End");
    assert(await panel.getByRole("menuitemradio", { name: "Investigation" }).evaluate(element => element === document.activeElement));
    assert.equal(await panel.getByRole("menuitemradio", { name: "Feature Default" }).getAttribute("aria-checked"), "true");
    await panel.screenshot({ path: "/tmp/checks-dropdown.png" });
    await page.keyboard.press("Escape");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const label of await panel.locator("summary > span[title]").all()) {
        assert.ok(await label.evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) + 1));
      }
      await panel.screenshot({ path: `/tmp/checks-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
