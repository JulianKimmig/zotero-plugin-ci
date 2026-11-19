/** Real ZIP behavior checks for optional exact packaged update-feed URL binding. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, archive } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
import { inspectArtifact } from '../src/artifact.mts';
import { object } from '../src/validation.mts';
import type { PluginConfig } from '../src/contracts.mts';

/** Package a real valid plugin with a chosen manifest discovery URL. @param updateURL Manifest update URL. @returns Admitted config and actual ZIP path. */
async function packagedURL(updateURL: string): Promise<{ config: PluginConfig; xpi: string }> {
  const root = await fixture(), config = await loadConfig(root), path = join(root, 'manifest.json');
  const manifest = object(JSON.parse(await readFile(path, 'utf8')));
  object(object(manifest.applications).zotero).update_url = updateURL;
  await writeFile(path, JSON.stringify(manifest));
  return { config, xpi: await archive(root) };
}

test('accepts an artifact whose packaged update URL exactly matches the expected stable feed', async () => {
  const updateURL = 'https://github.com/example/plugin/releases/latest/download/updates.json';
  const { config, xpi } = await packagedURL(updateURL);
  assert.equal((await inspectArtifact(xpi, config, '0.1.0', { updateURL })).id, config.plugin.id);
});

test('rejects a wrong HTTPS packaged update URL despite correct identity, version and compatibility', async () => {
  const { config, xpi } = await packagedURL('https://github.com/example/other/releases/latest/download/updates.json');
  await assert.rejects(inspectArtifact(xpi, config, '0.1.0', {
    updateURL: 'https://github.com/example/plugin/releases/latest/download/updates.json',
  }), /update.*URL/i);
});

test('default and historical inspection preserve a historical raw discovery URL without imposing the current feed', async () => {
  const { config, xpi } = await packagedURL('https://raw.githubusercontent.com/example/plugin/main/updates.json');
  assert.equal((await inspectArtifact(xpi, config, '0.1.0')).version, '0.1.0');
  assert.equal((await inspectArtifact(xpi, config, '0.1.0', { historical: true })).version, '0.1.0');
});

test('historical inspection enforces an exact URL only when explicitly provided', async () => {
  const updateURL = 'https://raw.githubusercontent.com/example/plugin/main/updates.json';
  const { config, xpi } = await packagedURL(updateURL);
  assert.equal((await inspectArtifact(xpi, config, '0.1.0', { historical: true, updateURL })).version, '0.1.0');
  await assert.rejects(inspectArtifact(xpi, config, '0.1.0', { historical: true,
    updateURL: 'https://github.com/example/plugin/releases/latest/download/updates.json' }), /update.*URL/i);
});
