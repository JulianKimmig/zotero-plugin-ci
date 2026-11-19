/** Release retry tests with fake external GitHub HTTP only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GitHub } from '../src/github.mts';
import { publishRelease } from '../src/publish.mts';
const bytes = Buffer.from('tested-xpi');
const sha256 = createHash('sha256').update(bytes).digest('hex');
test('conflicting existing asset is refused before publishing', async () => {
  const api = new GitHub('test', async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/git/ref/')) return Response.json({ object: { sha: 'commit', type: 'commit' } });
    if (path.endsWith('/assets/1')) return new Response('different');
    return Response.json({ id: 2, draft: true, prerelease: true, tag_name: 'v1.0.0', target_commitish: 'commit', assets: [{ id: 1, name: 'p.xpi' }] });
  });
  await assert.rejects(publishRelease(api, { repo: 'o/r', commit: 'commit', version: '1.0.0', assets: [{ name: 'p.xpi', bytes, sha256 }] }), /conflicting asset/);
});
test('retry verifies existing bytes then publishes same draft without uploading', async () => {
  const writes: string[] = [];
  const api = new GitHub('test', async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method !== 'GET') writes.push(`${init?.method} ${path}`);
    if (path.includes('/git/ref/')) return Response.json({ object: { sha: 'commit', type: 'commit' } });
    if (path.endsWith('/assets/1')) return new Response(bytes);
    return Response.json({ id: 2, draft: true, prerelease: true, tag_name: 'v1.0.0', target_commitish: 'commit', assets: [{ id: 1, name: 'p.xpi' }] });
  });
  await publishRelease(api, { repo: 'o/r', commit: 'commit', version: '1.0.0', assets: [{ name: 'p.xpi', bytes, sha256 }] });
  assert.deepEqual(writes, ['PATCH /repos/o/r/releases/2']);
});
