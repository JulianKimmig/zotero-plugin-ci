/** Behavioral tests of the GitHub transport boundary. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../src/github.mts';
test('HTTP failures surface without leaking credentials', async () => {
  const api = new GitHub('secret', async () => new Response('private', { status: 403 }));
  await assert.rejects(api.request('GET', '/repos/a/b'), /GitHub GET.*403/);
});
test('JSON requests authenticate and preserve request bodies', async () => {
  const api = new GitHub('token', async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer token');
    assert.deepEqual(JSON.parse(String(init?.body)), { sha: 'abc' });
    return Response.json({ ok: true });
  });
  assert.deepEqual(await api.request('POST', '/repos/a/b', { sha: 'abc' }), { ok: true });
});
