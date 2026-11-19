/** Metadata-only preparation policy tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPromotion, assertVersionCheck } from '../src/prepare.mts';
const pr = { number: 4, state: 'open', head: { ref: 'develop', sha: 'a', repo: { full_name: 'o/r' } }, base: { ref: 'main', sha: 'b' }, labels: [] };
test('only same-repository develop promotions are writable', () => {
  assertPromotion(pr, 'o/r', [pr]);
  assert.throws(() => assertPromotion({ ...pr, head: { ...pr.head, ref: 'feature' } }, 'o/r', [pr]));
  assert.throws(() => assertPromotion(pr, 'o/r', [pr, { ...pr, number: 5 }]));
  assert.throws(() => assertPromotion({ ...pr, head: { ...pr.head, repo: { full_name: 'fork/r' } } }, 'o/r', [pr]));
});
test('required version check compares a published preceding-main baseline', () => {
  assertVersionCheck('1.2.4', '1.2.4', 'b', 'b');
  assert.throws(() => assertVersionCheck('1.2.3', '1.2.4', 'b', 'b'));
  assert.throws(() => assertVersionCheck('1.2.4', '1.2.4', 'stale', 'b'));
});
