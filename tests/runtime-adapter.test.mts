/** Real npm adapter invocation tests with harmless fixture scripts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScript } from '../src/runtime-adapter.mts';
test('runs a declared script with exact trailing arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adapter-test-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'ci:build': 'node record.cjs' } }));
  await writeFile(join(root, 'record.cjs'), 'require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)))');
  await runScript(root, 'ci:build', ['--output', '/tmp/archive.xpi']);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'args.json'), 'utf8')), ['--output', '/tmp/archive.xpi']);
});
test('script errors fail the pipeline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adapter-fail-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { validate: 'exit 7' } }));
  await assert.rejects(runScript(root, 'validate', []));
});
