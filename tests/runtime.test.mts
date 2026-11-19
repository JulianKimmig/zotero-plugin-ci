/** Runtime archive safety tests independent of installed profiles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarListing, verifyRuntimeHash } from '../src/runtime.mts';
import { createHash } from 'node:crypto';
test('rejects traversal and linked entries before extraction', () => {
  for (const entry of ['../escape', '/absolute', 'root/../../escape']) {
    assert.throws(() => validateTarListing(`-rw-r--r-- user/group 1 2026-01-01 00:00 ${entry}\n`));
  }
  assert.throws(() => validateTarListing('lrwxrwxrwx user/group 0 2026-01-01 00:00 root/link -> /etc'));
});
test('accepts ordinary directory and regular file entries', () => {
  validateTarListing('drwxr-xr-x user/group 0 2026-01-01 00:00 root/\n-rwxr-xr-x user/group 4 2026-01-01 00:00 root/zotero\n');
});
test('runtime download must match exact SHA256', () => {
  const bytes = Buffer.from('archive');
  verifyRuntimeHash(bytes, createHash('sha256').update(bytes).digest('hex'));
  assert.throws(() => verifyRuntimeHash(bytes, '0'.repeat(64)), /SHA256/);
});
