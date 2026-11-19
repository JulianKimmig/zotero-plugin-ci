/** Published baseline ordering and feed integrity behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBaseline, verifyPreviousHash } from '../src/github-baseline.mts';
import { createHash } from 'node:crypto';
test('baseline uses semantic versions rather than release creation order', () => {
 const release = (tag_name: string) => ({ tag_name, draft: false, prerelease: false });
 assert.equal(selectBaseline([release('v1.9.0'), release('v1.10.0'), release('v2.0.0')], '2.0.0')?.tag_name, 'v1.10.0');
 assert.equal(selectBaseline([release('v2.1.0')], '2.0.0'), undefined);
});
test('previous archive is bound to cumulative feed digest', () => {
 const bytes = Buffer.from('previous');
 const hash = createHash('sha256').update(bytes).digest('hex');
 verifyPreviousHash(bytes, `sha256:${hash}`);
 assert.throws(() => verifyPreviousHash(bytes, `sha256:${'0'.repeat(64)}`));
});
