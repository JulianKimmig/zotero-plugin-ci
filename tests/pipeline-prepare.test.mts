/** Real preparation snapshots with mocked external downloads; production resolver/freezer remain real. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './core-fixture.mts';
import { prepareStage, supports } from '../src/pipeline-prepare.mts';
import { readJSON } from '../src/pipeline-io.mts';
test('compatibility checks support wildcard upper bounds and two-component aliases', () => {
 assert.equal(supports('10.0', { min: '10.0.0', max: '10.*' }), true);
 assert.equal(supports('10.99.3', { min: '10.0', max: '10.*' }), true);
 assert.equal(supports('11.0', { min: '10.0', max: '10.*' }), false);
 assert.equal(supports('9.0.9', { min: '10.0', max: '10.*' }), false);
});
test('preparation downloads once and preserves the exact source/runtime snapshot for replay', async t => {
 const root = await fixture(), configPath = join(root, '.github/zotero-plugin.json');
 const config = JSON.parse(await readFile(configPath, 'utf8')) as { runtime: { sha256: string } };
 const bytes = Buffer.from('frozen runtime bytes'); config.runtime.sha256 = createHash('sha256').update(bytes).digest('hex');
 await writeFile(configPath, JSON.stringify(config));
 const original = globalThis.fetch; process.env.GITHUB_TOKEN = 'external-transport-test-token'; t.after(() => { delete process.env.GITHUB_TOKEN; }); t.after(() => { globalThis.fetch = original; });
 let downloads = 0;
 globalThis.fetch = async input => {
  const url = String(input);
  if (url === 'https://api.github.com/repos/example/plugin/releases?per_page=100&page=1') return Response.json([]);
  if (url === 'https://example.org/zotero.tar.xz') { downloads++; return new Response(bytes); }
  throw new Error(`Unexpected external call ${url}`);
 };
 const identity = { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1' };
 const first = await prepareStage(root, join(root, 'first'), identity);
 assert.equal(downloads, 1); assert.equal(first.cells[0].sha256, config.runtime.sha256);
 await writeFile(join(root, 'resolution.json'), JSON.stringify(first.resolution));
 const replay = await prepareStage(root, join(root, 'replay'), identity, join(root, 'resolution.json'));
 assert.deepEqual(replay.resolution, first.resolution);
 assert.deepEqual(await readJSON(join(root, 'first', 'prepared.json')), first);
 assert.equal(downloads, 2);
});
test('a changed frozen replay archive fails its retained digest', async t => {
 const root = await fixture(); const original = globalThis.fetch; process.env.GITHUB_TOKEN = 'external-transport-test-token'; t.after(() => { delete process.env.GITHUB_TOKEN; }); t.after(() => { globalThis.fetch = original; });
 globalThis.fetch = async input => String(input).includes('/releases?') ? Response.json([]) : new Response('altered');
 await assert.rejects(prepareStage(root, join(root, 'bad'), { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1' }), /digest mismatch/);
});
test('reusing a frozen predecessor as a matrix target retains and checks its replay digest', async () => {
 const { bindFrozenTarget } = await import('../src/pipeline-prepare.mts');
 const pin = { version: '10.0.7', platform: 'linux-x64' as const, url: 'https://example.org/runtime', executable: 'zotero', sha256: 'a'.repeat(64), archive: 'runtime.archive' };
 const target = { id: '10.0.7-linux-x64', selectors: ['10.0.7'], version: pin.version, platform: pin.platform, url: pin.url, executable: pin.executable };
 assert.equal(bindFrozenTarget(target, pin).sha256, pin.sha256);
 assert.equal(Reflect.get(target, 'sha256'), pin.sha256);
 assert.throws(() => bindFrozenTarget({ ...target, sha256: 'b'.repeat(64) }, pin), /digest mismatch/);
});
test('preparation authenticates the tag catalogue without forwarding its workflow token to docs or archives', async t => {
 const { matrixFixture } = await import('./matrix-fixture.mts');
 const { root } = await matrixFixture({ targets: ['10.0.8'], platforms: ['linux-x64'] });
 const original = globalThis.fetch;
 process.env.GITHUB_TOKEN = 'external-transport-test-token';
 t.after(() => { globalThis.fetch = original; delete process.env.GITHUB_TOKEN; });
 const requests: { url: string; authorization: string | null }[] = [];
 globalThis.fetch = async (input, init) => {
  const url = String(input); requests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
  if (url.includes('/repos/zotero/zotero/tags?')) return Response.json([{ name: '10.0.8', commit: { sha: 'a'.repeat(40) } }]);
  if (url.startsWith('https://www.zotero.org/download/client/version?')) return new Response('10.0.8');
  if (url.startsWith('https://raw.githubusercontent.com/zotero/zotero-docs/main/content/')) return new Response('## Changes in 10.0.8 (November 19, 2026)\n\n- Stable release\n');
  if (url.endsWith('/releases?per_page=100&page=1')) return Response.json([]);
  if (url.startsWith('https://download.zotero.org/client/release/')) return new Response(init?.method === 'HEAD' ? null : 'frozen runtime');
  throw new Error(`Unexpected external URL ${url}`);
 };
 await prepareStage(root, join(root, 'prepared'), { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1' });
 const catalogue = requests.filter(request => request.url.includes('/repos/zotero/zotero/tags?'));
 assert.equal(catalogue.length, 1); assert.equal(catalogue[0].authorization, 'Bearer external-transport-test-token');
 const external = requests.filter(request => new URL(request.url).hostname !== 'api.github.com');
 assert.ok(external.some(request => request.url.includes('download.zotero.org')));
 assert.ok(external.some(request => request.url.includes('zotero-docs')));
 for (const request of external) assert.equal(request.authorization, null);
});
