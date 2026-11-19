/** A second local plugin exercises shared CI APIs with real files and ZIP bytes; no hosted/native proof. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { secondPlugin } from './fixtures/second-plugin.mts';
import { loadConfig } from '../src/config.mts';
import { readVersion, prepareVersions } from '../src/versions.mts';
import { inspectArtifact, createUpdateFeed } from '../src/artifact.mts';

/** Run a fixture-owned declared npm command. @param root Isolated checkout. @param script Validated script name. @returns Captured successful command output. */
function command(root: string, script: string): string {
  return execFileSync('npm', ['run', script], { cwd: root, encoding: 'utf8' });
}

test('second plugin loads its own identity, scripts and starting version', async () => {
  const root = await secondPlugin(), config = await loadConfig(root);
  assert.deepEqual(config.plugin, { id: 'citation-lantern@fixtures.invalid', slug: 'citation-lantern' });
  assert.deepEqual(config.scripts, { validate: 'fixture:check', build: 'fixture:pack', native: 'fixture:native' });
  assert.equal(await readVersion(root, config), '2.4.6');
  assert.match(command(root, config.scripts.validate), /fixture inputs valid/);
});

test('second plugin prepares all versions, builds a real XPI and emits its own cumulative feed', async () => {
  const root = await secondPlugin(), config = await loadConfig(root);
  assert.equal((await prepareVersions(root, config, '2.5.0')).length, 3);
  assert.equal(await readVersion(root, config), '2.5.0');
  assert.deepEqual(await prepareVersions(root, config, '2.5.0'), []);
  command(root, config.scripts.validate); command(root, config.scripts.build);
  const xpi = join(root, 'dist/citation-lantern-2.5.0.xpi');
  const artifact = await inspectArtifact(xpi, config, '2.5.0');
  assert.equal(artifact.id, config.plugin.id);
  assert.deepEqual(artifact.files, ['LICENSE', 'bootstrap.js', 'content/lantern.css', 'locale/en-US/lantern.ftl', 'manifest.json']);
  assert.equal(artifact.sha256, createHash('sha256').update(await readFile(xpi)).digest('hex'));
  for (const file of artifact.files) {
    assert.equal(artifact.entries[file], createHash('sha256').update(await readFile(join(root, file))).digest('hex'));
  }
  const previous = createUpdateFeed(config, '2.4.6', 'b'.repeat(64), 'fixture-owner/citation-lantern', null);
  const feed = createUpdateFeed(config, artifact.version, artifact.sha256, 'fixture-owner/citation-lantern', previous);
  assert.deepEqual(Object.keys(feed.addons), [config.plugin.id]);
  const updates = feed.addons[config.plugin.id].updates;
  assert.equal(updates.length, 2); assert.deepEqual(updates[0], previous.addons[config.plugin.id].updates[0]);
  assert.equal(updates[1].update_link, 'https://github.com/fixture-owner/citation-lantern/releases/download/v2.5.0/citation-lantern-2.5.0.xpi');
  assert.equal(updates[1].update_hash, `sha256:${artifact.sha256}`);
  assert.deepEqual(createUpdateFeed(config, artifact.version, artifact.sha256, 'fixture-owner/citation-lantern', feed), feed);
});

test('second plugin rejects mismatched identities and stale packaged versions', async () => {
  const root = await secondPlugin(), config = await loadConfig(root);
  command(root, config.scripts.build);
  const xpi = join(root, 'dist/citation-lantern-2.4.6.xpi');
  await assert.rejects(inspectArtifact(xpi, config, '2.5.0'), /version/i);
  await assert.rejects(inspectArtifact(xpi, { ...config, plugin: { ...config.plugin, id: 'reference-relationships@zotero-plugins.local' } }, '2.4.6'), /identity/i);
  const foreign = { addons: { 'reference-relationships@zotero-plugins.local': { updates: [] } } };
  assert.throws(() => createUpdateFeed(config, '2.4.6', 'a'.repeat(64), 'fixture-owner/citation-lantern', foreign));
});

test('second plugin detects a real version disagreement before preparation writes', async () => {
  const root = await secondPlugin(), config = await loadConfig(root);
  const path = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.version = '9.0.0'; await writeFile(path, JSON.stringify(manifest));
  const before = await readFile(join(root, 'package.json'));
  await assert.rejects(readVersion(root, config), /version/i);
  await assert.rejects(prepareVersions(root, config, '2.5.0'), /version/i);
  assert.deepEqual(await readFile(join(root, 'package.json')), before);
});
