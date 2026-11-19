/** New-helper promotion admits a v1 main base and v2 develop head without relaxing metadata boundaries. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './core-fixture.mts';
import { matrixFixture } from './matrix-fixture.mts';
import { GitHub } from '../src/github.mts';
import { preparePromotion } from '../src/prepare-metadata.mts';

test('new helper prepares a schema-v2 head over published schema-v1 main with the same version paths', async () => {
 const baseRoot = await fixture(), { root: headRoot, config } = await matrixFixture();
 const manifestPath = join(headRoot, config.versions.manifest);
 const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { applications: { zotero: { strict_min_version: string; strict_max_version: string } } };
 manifest.applications.zotero.strict_min_version = config.compatibility.min;
 manifest.applications.zotero.strict_max_version = config.compatibility.max;
 await writeFile(manifestPath, JSON.stringify(manifest));
 const base = 'a'.repeat(40), head = 'b'.repeat(40), prepared = 'c'.repeat(40);
 const pr = { number: 1, state: 'open', head: { ref: 'develop', sha: head, repo: { full_name: 'o/r' } }, base: { ref: 'main', sha: base }, labels: [] };
 const writes: { path: string; body: Record<string, unknown> }[] = [];
 const configReads: { ref: string; schema: number }[] = [];
 const api = new GitHub('external-transport-test-token', async (url, init) => {
  const parsed = new URL(String(url)), path = parsed.pathname;
  if (init?.method === 'GET') {
   if (path.endsWith('/pulls/1')) return Response.json(pr);
   if (path.endsWith('/pulls')) return Response.json([pr]);
   if (path.includes('/contents/')) {
    const ref = parsed.searchParams.get('ref'); assert.ok(ref === base || ref === head);
    const relative = path.split('/contents/')[1], content = await readFile(join(ref === base ? baseRoot : headRoot, relative), 'utf8');
    if (relative === '.github/zotero-plugin.json') configReads.push({ ref, schema: (JSON.parse(content) as { schemaVersion: number }).schemaVersion });
    return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') });
   }
   if (path.endsWith('/releases')) return Response.json([{ draft: false, prerelease: false, tag_name: 'v0.1.0', assets: [{ id: 10, name: 'updates.json' }] }]);
   if (path.endsWith('/releases/assets/10')) return new Response('{}');
   if (path.endsWith('/git/ref/tags/v0.1.0')) return Response.json({ object: { sha: base, type: 'commit' } });
   if (path.endsWith(`/git/commits/${head}`)) return Response.json({ tree: { sha: 'original-tree' } });
   if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] });
   throw new Error(`Unexpected metadata request ${path}`);
  }
  writes.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  return Response.json({ sha: path.endsWith('/commits') ? prepared : 'prepared-tree' });
 });
 const publicReads: string[] = [];
 await preparePromotion(api, 'o/r', 1, async url => { publicReads.push(String(url)); return new Response('{}'); });
 assert.deepEqual(configReads, [{ ref: head, schema: 2 }, { ref: base, schema: 1 }]);
 assert.deepEqual(publicReads, ['https://github.com/o/r/releases/download/v0.1.0/updates.json', 'https://github.com/o/r/releases/latest/download/updates.json']);
 const tree = writes.find(item => item.path.endsWith('/trees'))!.body.tree as { path: string; content: string }[];
 assert.deepEqual(tree.map(item => item.path).sort(), Object.values(config.versions).sort());
 for (const item of tree) assert.equal((JSON.parse(item.content) as { version: string }).version, '0.1.1');
 const lock = JSON.parse(tree.find(item => item.path === config.versions.lock)!.content) as { packages: { '': { version: string } } };
 assert.equal(lock.packages[''].version, '0.1.1');
 const updatedManifest = JSON.parse(tree.find(item => item.path === config.versions.manifest)!.content) as typeof manifest;
 assert.equal(updatedManifest.applications.zotero.strict_min_version, config.compatibility.min);
 assert.equal(updatedManifest.applications.zotero.strict_max_version, config.compatibility.max);
 assert.equal(writes.find(item => item.path.endsWith('/git/refs/heads/develop'))!.body.force, false);
 assert.equal(writes.at(-1)!.body.head_sha, prepared);
 assert.equal(writes.at(-1)!.body.conclusion, 'success');
});
