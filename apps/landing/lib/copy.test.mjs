import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { featureGroups } from './copy.ts';

const features = featureGroups.flatMap((group) => group.features);
const source = ['../app/page.tsx', '../app/why-cards.tsx', './copy.ts']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

test('implemented workflows are not advertised as coming soon', () => {
  const workflow = features.find((feature) => feature.name === 'Workflows');
  assert.ok(workflow);
  assert.notEqual(workflow.soon, true);
});

test('Skills and thread sharing have dedicated feature descriptions', () => {
  for (const name of ['Skills', 'Thread sharing']) {
    assert.ok(features.some((feature) => feature.name === name), `${name} is missing`);
  }
});

test('worktrees are described without automatic isolation or collision guarantees', () => {
  assert.equal(source.match(/Every parallel thread in its own|zero collisions|implement in parallel worktrees/)?.[0], undefined);
});

test('assignment does not promise automatic execution', () => {
  assert.equal(source.match(/Assign a task; work starts|Assign a task to an agent and execution starts/)?.[0], undefined);
});

test('thread copy does not promise universal team visibility or permanent retention', () => {
  assert.equal(source.match(/thread the whole team can read|readable by the whole team, forever/)?.[0], undefined);
});

test('self-hosting copy does not promise an installer or external-server exclusion', () => {
  assert.equal(source.match(/[Oo]ne script|self-host\.sh|never touches anyone else's servers/)?.[0], undefined);
});

test('screenshot slots do not load unrelated stock photos', () => {
  assert.equal(source.match(/picsum\.photos/)?.[0], undefined);
});

test('Checks are available and link to the public docs route', () => {
  const feature = features.find(feature => feature.name === 'Checks & evidence');
  assert.ok(feature);
  assert.notEqual(feature.soon, true);
  assert.ok(source.includes('`${site.docsUrl}docs/using/checks`'));
});
