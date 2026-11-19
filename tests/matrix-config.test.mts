/** Behavior tests for separate native compatibility and historical manifest inspection. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, archive } from './core-fixture.mts';
import { matrixFixture } from './matrix-fixture.mts';
import { loadConfig, compatibilityFor } from '../src/config.mts';
import { inspectArtifact, createUpdateFeed } from '../src/artifact.mts';

test('v1 keeps its pin and derives exact compatibility; v2 separates bounds and targets', async () => {
  const legacy = await loadConfig(await fixture());
  assert.deepEqual(compatibilityFor(legacy), { min: '10.0.7', max: '10.0.7' });
  const { config } = await matrixFixture();
  assert.deepEqual(compatibilityFor(config), { min: '10.0', max: '10.*' });
  assert.deepEqual(config.targets, ['10.latest.latest']);
  assert.equal(config.platforms.length, 3);
});

test('rejects invalid selectors, platforms, mixed schemas and reversed bounds', async () => {
  for (const changes of [{ targets: [] }, { targets: ['latest'] }, { targets: ['10.latest.1'] },
    { targets: ['01.0.latest'] }, { targets: ['10.0-beta'] }, { platforms: [] }, { platforms: ['windows-arm64'] },
    { platforms: ['linux-x64', 'linux-x64'] }, { compatibility: { min: '11.0', max: '10.*' } },
    { compatibility: { min: '10.*', max: '11.*' } }, { runtime: {} }, { targets: ['10.0', '10.0'] }]) {
    await assert.rejects(matrixFixture(changes));
  }
});

test('legacy configuration rejects Windows and macOS while matrix configuration admits them', async () => {
  for (const platform of ['windows-x64', 'macos-x64']) {
    const root = await fixture(), path = join(root, '.github/zotero-plugin.json');
    const raw = JSON.parse(await readFile(path, 'utf8')); raw.runtime.platform = platform;
    await writeFile(path, JSON.stringify(raw));
    await assert.rejects(loadConfig(root), /Linux/i);
    assert.deepEqual((await matrixFixture({ platforms: [platform] })).config.platforms, [platform]);
  }
});

test('feed uses declared compatibility independently of selected native tests', async () => {
  const { config } = await matrixFixture();
  const entry = createUpdateFeed(config, '0.1.0', 'a'.repeat(64), 'example/plugin', null).addons[config.plugin.id].updates[0];
  assert.deepEqual(entry.applications.zotero, { strict_min_version: '10.0', strict_max_version: '10.*' });
});

test('current artifact requires config bounds; historical artifact reports its own bounds', async () => {
  const { root, config } = await matrixFixture(), xpi = await archive(root);
  await assert.rejects(inspectArtifact(xpi, config, '0.1.0'), /compatibility/i);
  const previous = await inspectArtifact(xpi, config, '0.1.0', { historical: true });
  assert.deepEqual(previous.compatibility, { min: '10.0.7', max: '10.0.7' });
  const path = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.applications.zotero.strict_min_version = '10.0'; manifest.applications.zotero.strict_max_version = '10.*';
  await writeFile(path, JSON.stringify(manifest)); await archive(root);
  assert.deepEqual((await inspectArtifact(xpi, config, '0.1.0')).compatibility, config.compatibility);
});

test('historical mode still rejects reversed manifest compatibility and wrong identity', async () => {
  const { root, config } = await matrixFixture(), path = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.applications.zotero.strict_min_version = '11.0';
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(inspectArtifact(await archive(root), config, '0.1.0', { historical: true }), /compatibility/i);
});
