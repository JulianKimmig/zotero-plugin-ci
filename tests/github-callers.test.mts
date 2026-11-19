/** Thin caller generation rejects mutable refs and grants only required permissions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callers } from '../src/github-callers.mts';
test('requires immutable shared commit', () => {
 assert.throws(() => callers('owner/shared', 'main'));
 const files = callers('owner/shared', 'a'.repeat(40));
 assert.match(files['release.yml']!, /contents: write/);
 assert.match(files['prepare.yml']!, /pull_request_target/);
 assert.doesNotMatch(files['prepare.yml']!, /secrets: inherit/);
 for (const text of Object.values(files)) assert.match(text, /@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});
