/** Frozen runtime acquisition and cross-platform archive boundary tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeRuntime, installRuntime } from '../src/runtime.mts';
import { validateApplicationTree, validateZipListing } from '../src/runtime-archives.mts';

const target = { version: '10.0.8', platform: 'linux-x64' as const,
  url: 'https://download.zotero.org/client/release/10.0.8/Zotero.tar.xz', executable: 'Zotero/zotero' };
const exec = promisify(execFile);

test('freezes exact downloaded runtime bytes and refuses overwriting a prior resolution', async context => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-freeze-'));
  const bytes = Buffer.from('external runtime archive');
  const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const archive = join(root, 'runtime.tar.xz');
  const frozen = await freezeRuntime(target, archive);
  assert.deepEqual(frozen, { ...target, sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.deepEqual(await readFile(archive), bytes);
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(freezeRuntime(target, archive), /EEXIST/);
});

test('runtime acquisition fails on unsafe URLs or upstream failure without creating an archive', async context => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-failure-'));
  context.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(freezeRuntime({ ...target, url: 'http://download.zotero.org/runtime' }, join(root, 'http')), /HTTPS/);
  await assert.rejects(freezeRuntime(target, join(root, 'failed')), /503/);
  await assert.rejects(readFile(join(root, 'failed')), /ENOENT/);
});

test('frozen runtime installation verifies bytes before extraction or execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-integrity-'));
  const archive = join(root, 'archive'); await writeFile(archive, 'changed');
  await assert.rejects(installRuntime({ ...target, sha256: '0'.repeat(64) }, join(root, 'installed'), archive), /SHA256/);
});

test('installs an actual frozen Linux archive without another download', { skip: process.platform !== 'linux' }, async context => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-native-'));
  await mkdir(join(root, 'Zotero'));
  await writeFile(join(root, 'Zotero', 'zotero'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const archive = join(root, 'runtime.tar.xz');
  await exec('tar', ['-cJf', archive, '-C', root, 'Zotero']);
  const bytes = await readFile(archive), pin = { ...target, sha256: createHash('sha256').update(bytes).digest('hex') };
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  const executable = await installRuntime(pin, join(root, 'installed'), archive);
  assert.equal(await readFile(executable, 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(installRuntime(pin, join(root, 'installed'), archive), /EEXIST/);
});

test('Windows ZIP inspection rejects ambiguous, escaping and linked entries', () => {
  validateZipListing(['Zotero/', 'Zotero/zotero.exe'], '-rw-r--r--  2.0 unx 1 b- defN 26-Jan-01 00:00 Zotero/zotero.exe');
  for (const paths of [['../escape'], ['C:/escape'], ['Zotero/../escape'], ['Zotero\\escape'], ['A', 'a'], ['zotero.exe:stream']]) {
    assert.throws(() => validateZipListing(paths, ''));
  }
  assert.throws(() => validateZipListing(['link'], 'lrwxrwxrwx  2.0 unx 1 b- defN 26-Jan-01 00:00 link'), /link/);
});

test('macOS app inspection accepts contained links and rejects escaping links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-app-'));
  const app = join(root, 'Zotero.app'); await mkdir(app);
  await writeFile(join(app, 'actual'), 'runtime');
  await symlink('actual', join(app, 'internal'));
  await validateApplicationTree(app);
  await symlink('../outside', join(app, 'external'));
  await writeFile(join(root, 'outside'), 'outside');
  await assert.rejects(validateApplicationTree(app), /outside|escape/);
});
