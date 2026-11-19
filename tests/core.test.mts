/** Behavioral contract, version and packaged update-feed checks against real source. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, archive } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
import { nextVersion, readVersion, prepareVersions, assertPredecessor } from '../src/versions.mts';
import { inspectArtifact, createUpdateFeed } from '../src/artifact.mts';

test('loads a complete plugin configuration and matching versions', async () => {
  const root = await fixture(), config = await loadConfig(root);
  assert.equal(config.plugin.id, 'example@test'); assert.equal(await readVersion(root, config), '0.1.0');
});

test('rejects undeclared scripts, unknown configuration and unsafe paths', async () => {
  for (const change of [{ surprise: true }, { versions: { package: '../outside', lock: 'package-lock.json', manifest: 'manifest.json' } },
    { scripts: { validate: 'missing', build: 'ci:build', native: 'ci:native' } },
    { runtime: { version: '10.0.7', platform: 'linux-x64', url: 'http://example.org/file', sha256: 'a'.repeat(64), executable: 'zotero' } }]) {
    const root = await fixture(), path = join(root, '.github/zotero-plugin.json');
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...change }));
    await assert.rejects(loadConfig(root));
  }
});

test('refuses symlinked version inputs', async () => {
  const root = await fixture(), path = join(root, '.github/zotero-plugin.json');
  const config = JSON.parse(await readFile(path, 'utf8')); config.versions.package = 'alias.json';
  await symlink(join(root, 'package.json'), join(root, 'alias.json')); await writeFile(path, JSON.stringify(config));
  await assert.rejects(loadConfig(root), /symbolic/i);
});

test('computes standard semantic increments and ignores unrelated labels', () => {
  assert.equal(nextVersion('0.1.0', []), '0.1.1');
  assert.equal(nextVersion('0.1.0', ['documentation', 'release:minor']), '0.2.0');
  assert.equal(nextVersion('0.1.0', ['release:major']), '1.0.0');
  assert.equal(nextVersion('1.2.3', ['release:patch']), '1.2.4');
});

test('rejects conflicting/unsupported release labels and invalid base versions', () => {
  for (const labels of [['release:minor', 'release:major'], ['release:banana'], ['release:patch', 'release:patch']]) {
    assert.throws(() => nextVersion('0.1.0', labels));
  }
  for (const base of ['v1.0.0', '01.0.0', '1.0.0-beta', '1.0', '9007199254740992.0.0']) assert.throws(() => nextVersion(base, []));
});

test('prepares all source versions idempotently without changing package metadata', async () => {
  const root = await fixture(), config = await loadConfig(root);
  assert.deepEqual((await prepareVersions(root, config, '0.2.0')).sort(), ['manifest.json', 'package-lock.json', 'package.json']);
  assert.equal(await readVersion(root, config), '0.2.0');
  assert.deepEqual(await prepareVersions(root, config, '0.2.0'), []);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name, 'example');
});

test('mismatching source versions fail before any preparation writes', async () => {
  const root = await fixture(), config = await loadConfig(root), path = join(root, 'manifest.json');
  const value = JSON.parse(await readFile(path, 'utf8')); value.version = '0.9.0'; await writeFile(path, JSON.stringify(value));
  const before = await readFile(join(root, 'package.json'));
  await assert.rejects(readVersion(root, config), /version/i);
  await assert.rejects(prepareVersions(root, config, '0.2.0'), /version/i);
  assert.deepEqual(await readFile(join(root, 'package.json')), before);
});

test('inspects actual ZIP bytes and generates a hash-bound cumulative feed', async () => {
  const root = await fixture(), config = await loadConfig(root), xpi = await archive(root);
  const info = await inspectArtifact(xpi, config, '0.1.0'); assert.equal(info.files.length, 3);
  assert.match(info.sha256, /^[a-f0-9]{64}$/);
  const previous = { addons: { 'example@test': { updates: [{ version: '0.0.9', update_link: 'https://example.org/old.xpi',
    update_hash: 'sha256:' + 'b'.repeat(64), applications: { zotero: { strict_min_version: '10.0.7', strict_max_version: '10.0.7' } } }] } } };
  const feed = createUpdateFeed(config, info.version, info.sha256, 'example/plugin', previous);
  const updates = feed.addons['example@test'].updates;
  assert.equal(updates.length, 2); assert.equal(updates[1].update_hash, 'sha256:' + info.sha256);
  assert.equal(updates[1].update_link, 'https://github.com/example/plugin/releases/download/v0.1.0/example-0.1.0.xpi');
});

test('artifact identity, version and unsafe archive inputs are rejected', async () => {
  const root = await fixture(), config = await loadConfig(root), xpi = await archive(root);
  await assert.rejects(inspectArtifact(xpi, config, '0.2.0'), /version/i);
  await assert.rejects(inspectArtifact(xpi, { ...config, plugin: { ...config.plugin, id: 'different@test' } }, '0.1.0'), /identity/i);
});

test('feed refuses conflicting histories, invalid digests and unexpected identities', async () => {
  const root = await fixture(), config = await loadConfig(root);
  assert.throws(() => createUpdateFeed(config, '0.1.0', 'bad', 'example/plugin', { addons: {} }));
  assert.throws(() => createUpdateFeed(config, '0.1.0', 'a'.repeat(64), 'example/plugin', { addons: { other: { updates: [] } } }));
});

test('symlink archive members are refused without extracting their targets', async () => {
  const root = await fixture(), config = await loadConfig(root), xpi = await archive(root);
  await symlink('manifest.json', join(root, 'alias.json'));
  execFileSync('zip', ['-q', '-y', xpi, 'alias.json'], { cwd: root });
  await assert.rejects(inspectArtifact(xpi, config, '0.1.0'), /symbolic/i);
});

test('update feed cannot regress below a previously published version', async () => {
  const root = await fixture(), config = await loadConfig(root);
  const previous = createUpdateFeed(config, '1.0.0', 'a'.repeat(64), 'example/plugin', null);
  assert.throws(() => createUpdateFeed(config, '0.2.0', 'b'.repeat(64), 'example/plugin', previous), /older|regress/i);
  assert.deepEqual(createUpdateFeed(config, '1.0.0', 'a'.repeat(64), 'example/plugin', previous), previous);
});

test('predecessor ordering compares semantic components rather than version strings', () => {
  assert.doesNotThrow(() => assertPredecessor('0.2.9', '0.10.0'));
  assert.doesNotThrow(() => assertPredecessor('0.1.0', '0.1.1'));
});

test('same versions, downgrades and nonstable predecessors cannot prove an upgrade', () => {
  for (const [previous, current] of [['0.1.1', '0.1.1'], ['1.0.0', '0.9.9'], ['0.01.0', '0.2.0'], ['0.1.0-beta', '0.1.0']]) {
    assert.throws(() => assertPredecessor(previous, current));
  }
});
