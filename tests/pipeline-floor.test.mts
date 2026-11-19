/** Historical-floor preparation uses real XPIs and mocks only external published/download resources. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, archive } from './core-fixture.mts';
import { prepareStage } from '../src/pipeline-prepare.mts';
for (const { target, floor, host } of [
 { target: '10.0.8', floor: '10.0.7', host: '10.0.7' },
 { target: '10.0.7', floor: '10.0.7', host: '10.0.7' },
 { target: '10.1.1', floor: '10.0.0', host: '10.0' },
 { target: '10.0', floor: '10.0.0', host: '10.0' },
 { target: '10.1.1', floor: '10.0', host: '10.0' },
]) {
 test(`historical floor ${floor} is provisioned for compatible target ${target}`, async t => {
  const root = await fixture(), manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; applications: { zotero: { strict_min_version: string; strict_max_version: string } } };
  manifest.version = '0.0.9'; manifest.applications.zotero.strict_min_version = floor; manifest.applications.zotero.strict_max_version = '10.*';
  await writeFile(manifestPath, JSON.stringify(manifest));
  const previous = await readFile(await archive(root));
  manifest.version = '0.1.0'; manifest.applications.zotero.strict_min_version = target; manifest.applications.zotero.strict_max_version = target;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const configPath = join(root, '.github/zotero-plugin.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { runtime: { version: string; sha256: string } };
  const bytes = Buffer.from('frozen runtime'); config.runtime.version = target; config.runtime.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(configPath, JSON.stringify(config));
  const previousHash = createHash('sha256').update(previous).digest('hex');
  const feed = { addons: { 'example@test': { updates: [{ version: '0.0.9', update_hash: `sha256:${previousHash}` }] } } };
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; delete process.env.GITHUB_TOKEN; });
  process.env.GITHUB_TOKEN = 'external-transport-test-token'; const downloads: string[] = [];
  globalThis.fetch = async input => {
   const url = String(input);
   if (url.endsWith('/releases?per_page=100&page=1')) return Response.json([{ draft: false, prerelease: false, tag_name: 'v0.0.9', assets: [{ id: 1, name: 'updates.json' }, { id: 2, name: 'previous.xpi' }] }]);
   if (url.endsWith('/releases/assets/1')) return Response.json(feed);
   if (url.endsWith('/releases/assets/2')) return new Response(previous);
   if (url === 'https://example.org/zotero.tar.xz' || url === `https://download.zotero.org/client/release/${host}/Zotero-${host}_linux-x86_64.tar.xz`) { downloads.push(url); return new Response(bytes); }
   throw new Error(`Unexpected external URL ${url}`);
  };
  const state = await prepareStage(root, join(root, 'prepared'), { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1' });
  assert.equal(state.cells[0].previousRuntime?.version, host);
  assert.equal(state.cells[0].previousRuntime?.sha256, config.runtime.sha256);
  assert.equal(downloads.length, target === host ? 1 : 2);
  assert.equal(Object.keys(state.runtimes).length, target === host ? 1 : 2);
 });
}
