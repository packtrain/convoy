import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchChromium } from '../lib/browser.mjs';

// Run after the landing build; serve its HTML through browser interception.
const root = fileURLToPath(new URL('../', import.meta.url));
const scenes = ['hero', 'workflows', 'skills-agents', 'watch-tower', 'artifact-review', 'thread-groups', 'agent-threads', 'remote-thread', 'task-assignment', 'project-organization', 'task-artifacts', 'checks', 'environments', 'self-hosting'];

const serve = (page, { blockScripts = false } = {}) => page.route('**/*', async route => {
  const path = new URL(route.request().url()).pathname;
  const file = path === '/' ? `${root}.next/server/app/index.html` : path.startsWith('/_next/static/') ? `${root}.next/static/${path.slice(14)}` : `${root}public${path}`;
  if (blockScripts && file.endsWith('.js')) return route.abort();
  try {
    const body = await readFile(file);
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/svg+xml';
    await route.fulfill({ body, contentType });
  } catch { await route.abort(); }
});

test('marketing copy stays visible when script requests fail', async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await serve(page, { blockScripts: true });
  try {
    await page.goto('https://convoy.localhost/');
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.reveal')].filter(el => getComputedStyle(el).opacity !== '1').length);
    assert.equal(hidden, 0, `${hidden} reveal blocks stay hidden without scripts`);
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1, 'one marketing H1');
    assert.equal(await page.getByRole('main').count(), 1);
  } finally { await browser.close(); }
});

test('the hero headline rolls between working and building on two lines', async () => {
  const browser = await launchChromium();
  const words = ['working', 'building'];
  const at = (page, index) => page.evaluate(index => {
    const slot = document.querySelector('h1 .word-roll');
    for (const animation of slot.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 2000 + index * 4000;
    }
    const box = slot.getBoundingClientRect();
    const shown = [...slot.children].filter(word => [...word.children].every(letter => {
      const rect = letter.getBoundingClientRect();
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && getComputedStyle(letter).opacity === '1';
    }));
    const heading = document.querySelector('h1');
    return {
      shown: shown.map(word => word.textContent),
      transforms: shown.map(word => getComputedStyle(word.firstChild).transform),
      height: heading.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      lines: [...heading.children].map(line => Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight))),
    };
  }, index);
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const width of [1560, 1024, 768, 640, 390, 320]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion });
        await serve(page);
        await page.goto('https://convoy.localhost/');
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.getByRole('heading', { level: 1, name: 'Your best way of working with AI.', exact: true }).count(), 1);
        assert.equal(await page.getByText("Turn your team's expertise into reusable workflows for AI agents. Assign tasks, guide the work, and review results in one place.", { exact: true }).count(), 1);
        let height;
        for (const [index, word] of words.entries()) {
          const state = await at(page, index);
          assert.deepEqual(state.shown, [word], `${word} at ${width}px, ${reducedMotion}`);
          assert.deepEqual(state.lines, [1, 1]);
          assert.equal(state.overflow, false, `no overflow at ${width}px`);
          height ??= state.height;
          assert.ok(Math.abs(state.height - height) < 0.1, 'rotation does not shift the headline');
          if (reducedMotion === 'reduce') assert.deepEqual(state.transforms, ['none']);
        }
        await mkdir('/tmp/convoy-homepage-check', { recursive: true });
        if (reducedMotion === 'no-preference' && [1560, 390, 320].includes(width)) {
          await page.screenshot({ path: `/tmp/convoy-homepage-check/hero-${width}.png` });
        }
        await page.close();
      }
    }
  } finally { await browser.close(); }
});

test('hero letters never cross the slot while jumping back below it', async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
  await serve(page);
  try {
    await page.goto('https://convoy.localhost/');
    await page.evaluate(() => document.fonts.ready);
    // A frame can land inside the 50% -> 50.01% jump; sample its midpoint.
    const crossing = await page.evaluate(() => {
      const slot = document.querySelector('h1 .word-roll');
      const box = slot.getBoundingClientRect();
      return slot.getAnimations({ subtree: true }).filter(animation => {
        animation.pause();
        animation.currentTime = 8000 + 4000.4 + animation.effect.getTiming().delay;
        const rect = animation.effect.target.getBoundingClientRect();
        return rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
      }).map(animation => animation.effect.target.textContent);
    });
    assert.deepEqual(crossing, []);
  } finally { await browser.close(); }
});

test('GitHub buttons are glass pills', async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
  await serve(page);
  try {
    await page.goto('https://convoy.localhost/');
    const styles = await page.getByRole('link', { name: 'View on GitHub' }).evaluateAll(links => links.map(link => {
      const style = getComputedStyle(link);
      return { radius: parseFloat(style.borderTopLeftRadius) >= link.getBoundingClientRect().height / 2, blur: style.backdropFilter, opaque: style.backgroundColor.startsWith('rgb(') };
    }));
    assert.equal(styles.length, 3);
    for (const style of styles) assert.deepEqual(style, { radius: true, blur: 'blur(12px)', opaque: false });
  } finally { await browser.close(); }
});

test('built homepage renders all shared previews and keeps interactions local', async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await serve(page);
  try {
    await page.goto('https://convoy.localhost/');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelector('#cta').hasAttribute('data-pending'), null, { timeout: 5000 });
    const splitOrder = await page.evaluate(() => ['checks', 'environments', 'self-hosting'].map(name => {
      const preview = document.querySelector(`[data-preview="${name}"]`);
      return preview.previousElementSibling.getBoundingClientRect().left < preview.getBoundingClientRect().left;
    }));
    assert.deepEqual(splitOrder, [true, false, true], 'following sections alternate text and preview');
    assert.equal(await page.locator('[data-preview]').count(), scenes.length);
    assert.equal(await page.locator('img[src*="app-screenshot"]').count(), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /2\.1k/, 'no placeholder star count');
    assert.doesNotMatch(await page.locator('body').innerText(), /Get started/, 'GitHub is the only call to action');
    for (const scope of ['nav', 'main > section', '#cta']) {
      const links = page.locator(scope).first().getByRole('link', { name: /GitHub/ });
      assert.equal(await links.count(), 1, `${scope} has one GitHub button`);
      assert.equal((await links.innerText()).trim(), 'View on GitHub');
      assert.ok((await links.locator('svg').first().boundingBox()).width >= 16, `${scope} GitHub button shows the GitHub mark`);
    }
    await mkdir('/tmp/convoy-homepage-check', { recursive: true });
    await page.screenshot({ path: '/tmp/convoy-homepage-check/above-fold.png' });
    const hero = page.locator('[data-preview="hero"]');
    const layout = await page.evaluate(() => {
      const preview = document.querySelector('[data-preview="hero"]').getBoundingClientRect();
      return {
        height: preview.height,
        overhang: preview.bottom - document.querySelector('[data-preview="hero"]').closest('section').getBoundingClientRect().bottom,
        gap: document.querySelector('#product').getBoundingClientRect().top - preview.bottom,
      };
    });
    assert.ok(layout.height >= 900, `hero preview is ${layout.height}px tall`);
    assert.ok(layout.overhang >= 200, `hero preview overhangs the animation by ${layout.overhang}px`);
    assert.ok(layout.gap >= 0, `hero preview overlaps the next section by ${-layout.gap}px`);
    const copyTopWhenCardAt = top => page.evaluate(top => {
      const copy = document.querySelector('[data-preview="workflows"]').previousElementSibling;
      window.scrollBy(0, copy.getBoundingClientRect().top - top);
      return copy.querySelector('h3').getBoundingClientRect().top;
    }, top);
    const restingTop = await copyTopWhenCardAt(600);
    assert.ok(Math.abs(restingTop - 640) < 1, `card copy should start at the top of its column, got ${restingTop}`);
    const rows = await page.evaluate(() => Object.fromEntries(['task-assignment', 'project-organization', 'task-artifacts'].map(name => {
      const preview = document.querySelector(`[data-preview="${name}"]`);
      const h3 = preview.parentElement.querySelector('h3'), column = h3.parentElement;
      const row = preview.parentElement.getBoundingClientRect(), copy = column.getBoundingClientRect(), box = preview.getBoundingClientRect();
      return [name, { copyTop: h3.getBoundingClientRect().top - copy.top - parseFloat(getComputedStyle(column).paddingTop), copyBottom: copy.bottom, copyLeft: copy.left, previewTop: box.top, previewLeft: box.left, previewWidth: box.width, rowWidth: row.width }];
    })));
    assert.ok(Math.abs(rows['task-assignment'].copyTop) < 1, `platform copy starts at the top of its column, sits ${rows['task-assignment'].copyTop}px down`);
    assert.ok(rows['project-organization'].copyBottom <= rows['project-organization'].previewTop, 'project copy sits above its preview');
    assert.equal(rows['project-organization'].previewWidth, rows['project-organization'].rowWidth, 'project preview spans the full row');
    assert.ok(rows['task-artifacts'].copyLeft > rows['task-artifacts'].previewLeft, 'artifact copy sits right of its preview');
    const agentLayout = await page.evaluate(() => {
      const scene = document.querySelector('[data-preview="agent-threads"]');
      const thread = scene.querySelector('[aria-label="Lead thread"]').getBoundingClientRect();
      return [...scene.querySelectorAll('li')].map(li => li.getBoundingClientRect()).map(box => box.right <= thread.left || box.left >= thread.right);
    });
    assert.ok(agentLayout.every(Boolean), 'agent threads sit beside the lead thread at desktop width');
    const projectFrame = await page.locator('[data-preview="project-organization"] > div').first().evaluate(el => ({ height: el.getBoundingClientRect().height, fade: getComputedStyle(el, '::after').backgroundImage, bottom: getComputedStyle(el).borderBottomWidth }));
    assert.ok(projectFrame.height <= 520, `project frame trims empty space below the table, got ${projectFrame.height}px`);
    assert.match(projectFrame.fade, /gradient/, 'project frame fades out at the bottom');
    assert.equal(projectFrame.bottom, '0px', 'faded edge has no bottom border');
    const lower = await page.evaluate(() => {
      const heading = document.querySelector('#agents h2'), own = document.getElementById('self-hosting');
      const section = own.getBoundingClientRect(), diagram = document.querySelector('[data-preview="self-hosting"]').getBoundingClientRect();
      return {
        headingBreak: !!heading.querySelector('br'),
        headingLines: Math.round(heading.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight)),
        beforeIndex: !!(own.compareDocumentPosition(document.getElementById('features')) & Node.DOCUMENT_POSITION_FOLLOWING),
        diagramRight: diagram.left >= own.querySelector('h2').getBoundingClientRect().right,
        copyTop: own.querySelector('h2').getBoundingClientRect().top - section.top,
        copyWidth: own.querySelector('h2').parentElement.getBoundingClientRect().width,
      };
    });
    assert.ok(lower.headingBreak && lower.headingLines === 2, `agents heading breaks after its first sentence, ${lower.headingLines} lines`);
    assert.equal(await page.locator('#environments + #self-hosting').count(), 1, 'environment management immediately precedes self-hosting');
    assert.equal(await page.locator('[data-preview="environments"] figure').count(), 1, 'TUI is rendered as HTML');
    assert.ok(lower.beforeIndex, 'Run Convoy yourself sits above the feature index');
    assert.ok(lower.diagramRight, 'self-hosting diagram sits right of its copy');
    assert.equal(lower.copyWidth, 320, 'self-hosting copy column matches the platform rows');
    assert.ok(lower.copyTop < 60, `self-hosting copy starts at the top, ${lower.copyTop}px down`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await hero.getByRole('button', { name: 'Watch Tower', exact: true }).click();
    assert.equal(await hero.locator('[data-watch-tower]').getAttribute('data-watch-tower'), 'board');
    await hero.getByRole('button', { name: 'Milestone 2', exact: true }).click();
    await hero.getByRole('button', { name: 'Kanban view' }).click();
    const project = page.locator('[data-preview="project-organization"]');
    assert.equal(await project.locator('[data-project-view]').getAttribute('data-project-view'), 'board', 'project section opens on the Kanban board');
    await project.getByRole('button', { name: 'Table view' }).click();
    assert.equal(await project.locator('[data-project-view]').getAttribute('data-project-view'), 'table');
    const artifacts = page.locator('[data-preview="task-artifacts"]');
    await artifacts.getByRole('button', { name: /Test report/ }).click();
    assert.equal(await artifacts.getByRole('heading', { name: 'Retry test report' }).count(), 1);
    const groups = page.locator('[data-preview="thread-groups"]');
    await groups.getByRole('tab').nth(1).click();
    assert.equal(await groups.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true');
    await hero.getByRole('button', { name: 'Threads', exact: true }).click();
    const folder = '/tmp/convoy-homepage-check';
    await mkdir(folder, { recursive: true });
    for (const width of [1560, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of scenes) {
        const scene = page.locator(`[data-preview="${name}"]`);
        await scene.scrollIntoViewIfNeeded();
        await page.waitForFunction(name => {
          const node = document.querySelector(`[data-preview="${name}"]`);
          const reveal = node.closest('.reveal');
          return !reveal || getComputedStyle(reveal).opacity === '1';
        }, name);
        const box = await scene.boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0, `${name} has no visible scene at ${width}`);
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${name} leaves the viewport at ${width}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `page overflows ${overflow}px at ${width}, ${name}`);
        if (width === 1560 || width === 390) await scene.screenshot({ path: `${folder}/${name}-${width}.png` });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
