/** Preparation integration through fake HTTP and real JSON/version modules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './core-fixture.mts';
import { GitHub } from '../src/github.mts';
import { preparePromotion } from '../src/prepare-metadata.mts';
test('preparation writes only version JSON and completes the resulting head check', async () => {
  const root = await fixture();
  const pr = { number: 1, state: 'open', head: { ref: 'develop', sha: 'head', repo: { full_name: 'o/r' } }, base: { ref: 'main', sha: 'base' }, labels: [] };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const api = new GitHub('fake', async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === 'GET') {
      if (path.endsWith('/pulls/1')) return Response.json(pr);
      if (path.endsWith('/pulls')) return Response.json([pr]);
      if (path.includes('/contents/')) return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(await readFile(join(root, path.split('/contents/')[1]!), 'utf8')).toString('base64') });
      if (path.endsWith('/releases')) return Response.json([{ draft: false, prerelease: false, tag_name: 'v0.1.0', assets: [{ id: 10, name: 'updates.json' }] }]);
      if (path.endsWith('/releases/assets/10')) return new Response('{}');
      if (path.includes('/git/ref/tags/')) return Response.json({ object: { sha: 'base', type: 'commit' } });
      if (path.includes('/git/commits/')) return Response.json({ tree: { sha: 'tree' } });
      if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] });
      throw new Error(`Unexpected metadata read ${path}`);
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    writes.push({ path, body });
    return Response.json({ sha: path.endsWith('/commits') ? 'prepared' : 'tree' });
  });
  await preparePromotion(api, 'o/r', 1, async () => new Response('{}'));
  const tree = writes.find(item => item.path.endsWith('/trees'))!.body.tree as { path: string; content: string }[];
  assert.deepEqual(tree.map(item => item.path).sort(), ['manifest.json', 'package-lock.json', 'package.json']);
  for (const item of tree) assert.equal(JSON.parse(item.content).version, '0.1.1');
  assert.equal(writes.at(-1)!.body.head_sha, 'prepared');
  assert.equal(writes.at(-1)!.body.conclusion, 'success');
});
/** Exercise initial adoption where main predates CI configuration. */
async function initialAdoption(baseSha: string, stableRelease = false, bootstrap = true, baseConfigMissing = true, stableVersion = '0.1.0'): Promise<{ path: string; body: Record<string, unknown> }[]> {
  const root = await fixture();
  const { writeFile } = await import('node:fs/promises');
  const configPath = join(root, '.github/zotero-plugin.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (bootstrap) config.bootstrap = { commit: 'a'.repeat(40), version: '0.1.0' };
  await writeFile(configPath, JSON.stringify(config));
  const pr = { number: 1, state: 'open', head: { ref: 'develop', sha: 'head', repo: { full_name: 'o/r' } }, base: { ref: 'main', sha: baseSha }, labels: [] };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const api = new GitHub('fake', async (url, init) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    if (init?.method === 'GET') {
      if (path.endsWith('/pulls/1')) return Response.json(pr);
      if (path.endsWith('/pulls')) return Response.json([pr]);
      if (path.includes('/contents/')) {
        if (baseConfigMissing && parsed.searchParams.get('ref') === baseSha && path.endsWith('/.github/zotero-plugin.json')) return new Response('', { status: 404 });
        return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(await readFile(join(root, path.split('/contents/')[1]!), 'utf8')).toString('base64') });
      }
      if (path.endsWith('/releases')) return Response.json(stableRelease ? [{ draft: false, prerelease: false, tag_name: `v${stableVersion}` }] : []);
      if (path.includes('/git/commits/')) return Response.json({ tree: { sha: 'tree' } });
      if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] });
      throw new Error(`Unexpected request ${path}`);
    }
    writes.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json({ sha: path.endsWith('/commits') ? 'prepared' : 'tree' });
  });
  await preparePromotion(api, 'o/r', 1, async () => new Response('{}'));
  return writes;
}
test('initial adoption accepts only the declared bootstrap base without historical CI config', async () => {
  const writes = await initialAdoption('a'.repeat(40));
  assert.equal(writes.at(-1)!.body.conclusion, 'success');
});
test('initial adoption refuses an unrelated base missing CI config', async () => {
  await assert.rejects(initialAdoption('b'.repeat(40)));
});
test('initial adoption cannot bypass an existing published baseline', async () => {
  await assert.rejects(initialAdoption('a'.repeat(40), true));
});

test('first publication seeds a configured main version without bootstrap or release history', async () => {
  const writes = await initialAdoption('b'.repeat(40), false, false, false);
  const tree = writes.find(item => item.path.endsWith('/trees'))!.body.tree as { content: string }[];
  for (const item of tree) assert.equal(JSON.parse(item.content).version, '0.1.1');
  assert.equal(writes.at(-1)!.body.conclusion, 'success');
});
test('first-publication seeding cannot bypass existing stable release history', async () => {
  await assert.rejects(initialAdoption('b'.repeat(40), true, false, false, '0.0.9'), /Missing published baseline/);
});
