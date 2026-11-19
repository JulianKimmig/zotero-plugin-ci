/** Public release readback tests fake only the external download boundary. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPublicAssets } from '../src/publish-public.mts';
const bytes = Buffer.from('{"feed":true}');
const assets = [{ name: 'updates.json', sha256: createHash('sha256').update(bytes).digest('hex') }];
test('verifies version-specific downloads and stable latest feed', async () => {
 const requests: string[] = [];
 await verifyPublicAssets('o/r', '1.0.0', assets, async url => { requests.push(String(url)); return new Response(bytes); });
 assert.deepEqual(requests, ['https://github.com/o/r/releases/download/v1.0.0/updates.json', 'https://github.com/o/r/releases/latest/download/updates.json']);
});
test('refuses missing public assets and changed stable feed bytes', async () => {
 await assert.rejects(verifyPublicAssets('o/r', '1.0.0', assets, async () => new Response('', { status: 404 })), /Public download/);
 await assert.rejects(verifyPublicAssets('o/r', '1.0.0', assets, async url => new Response(String(url).includes('/latest/') ? 'wrong' : bytes)), /Public hash/);
});
