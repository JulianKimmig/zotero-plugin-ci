/** File transport and diagnostic sanitization behavior, using real temporary files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashFile, readJSON, sanitizeLog } from '../src/pipeline-io.mts';
test('hashing and JSON reads reject symlink inputs', async () => {
 const root = await mkdtemp(join(tmpdir(), 'pipeline-io-'));
 await writeFile(join(root, 'real'), '{}'); await symlink(join(root, 'real'), join(root, 'link'));
 assert.equal((await hashFile(join(root, 'real'))).length, 64);
 await assert.rejects(hashFile(join(root, 'link')));
 await assert.rejects(readJSON(join(root, 'link')));
});
test('sanitization removes credentials, local profile paths and control commands', () => {
 const log = 'token SECRET https://user:pass@example.org/path?token=abc /home/person/.zotero/profile C:\\Users\\person\\profile ::warning::injected';
 const clean = sanitizeLog(log, ['SECRET'], ['/home/person', 'C:\\Users\\person']);
 for (const forbidden of ['SECRET', 'user:pass', 'token=abc', '/home/person', 'C:\\Users\\person', '::warning::']) assert.ok(!clean.includes(forbidden));
});
test('receipt transport preserves duplicate filenames in separate downloaded artifacts', async () => {
 const { mkdir } = await import('node:fs/promises');
 const { readReceipts } = await import('../src/pipeline-io.mts');
 const root = await mkdtemp(join(tmpdir(), 'pipeline-receipts-'));
 for (const name of ['one', 'two']) { await mkdir(join(root, name)); await writeFile(join(root, name, 'same.receipt.json'), JSON.stringify({ cell: 'same' })); }
 assert.equal((await readReceipts(root)).length, 2);
});
test('recursive native diagnostics are sanitized and unexpected profile files are rejected', async () => {
 const { mkdir, readFile } = await import('node:fs/promises');
 const { sanitizeDirectory } = await import('../src/pipeline-io.mts');
 const root = await mkdtemp(join(tmpdir(), 'pipeline-logs-')); await mkdir(join(root, 'native'));
 await writeFile(join(root, 'native', 'runtime.log'), 'private-secret /owned/profile');
 await sanitizeDirectory(root, ['private-secret'], ['/owned']);
 assert.equal(await readFile(join(root, 'native', 'runtime.log'), 'utf8'), '[REDACTED] [REDACTED]/profile');
 await writeFile(join(root, 'native', 'zotero.sqlite'), 'private profile');
 await assert.rejects(sanitizeDirectory(root, [], []), /Only log files/);
});
