/** Real generated-tool transport proves layout, module execution, and containment without source mocks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, access, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stageNativeTools } from '../src/native-tools.mts';
import { matrixFixture } from './matrix-fixture.mts';
import { fixture } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
test('declared dist tools restore with relative imports and execute on the receiving checkout', async () => {
 const { root, config } = await matrixFixture({ nativeTools: ['dist/native.mjs'] });
 await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/native.mjs'), 'console.log("native tools restored")');
 const work = await mkdtemp(join(tmpdir(), 'native-tools-')), staging = join(work, 'staging'), restored = join(work, 'consumer');
 assert.equal(await stageNativeTools(root, config.nativeTools, staging), true);
 await mkdir(restored); await cp(staging, restored, { recursive: true });
 assert.equal(await readFile(join(restored, 'dist/native.mjs'), 'utf8'), await readFile(join(root, 'dist/native.mjs'), 'utf8'));
 const executed = await promisify(execFile)(process.execPath, [join(restored, 'dist/native.mjs')]);
 assert.equal(executed.stdout.trim(), 'native tools restored');
});
test('declared directories preserve hidden generated trees and nested module dependencies', async () => {
 const { root, config } = await matrixFixture({ nativeTools: ['.generated', 'dist'] });
 await mkdir(join(root, '.generated')); await mkdir(join(root, 'dist'));
 await writeFile(join(root, '.generated/value.mjs'), 'export const value = "restored import";');
 await writeFile(join(root, 'dist/native.mjs'), 'import { value } from "../.generated/value.mjs"; console.log(value);');
 const work = await mkdtemp(join(tmpdir(), 'native-directories-')), staging = join(work, 'staging'), restored = join(work, 'consumer');
 await stageNativeTools(root, config.nativeTools, staging); await cp(staging, restored, { recursive: true });
 assert.equal((await promisify(execFile)(process.execPath, [join(restored, 'dist/native.mjs')])).stdout.trim(), 'restored import');
});
test('omitted or empty nativeTools produces no artifact and never discovers .build implicitly', async () => {
 const { root, config } = await matrixFixture(); await mkdir(join(root, '.build')); await writeFile(join(root, '.build/ignored.mjs'), 'throw Error()');
 const output = join(root, 'transport');
 assert.equal(await stageNativeTools(root, config.nativeTools, output), false);
 assert.equal(await stageNativeTools(root, [], output), false);
 await assert.rejects(access(output));
});
test('config rejects traversal, secret/profile/dependency paths, duplicates and overlapping declarations', async () => {
 for (const nativeTools of [['../outside'], ['/absolute'], ['dist\\native.mjs'], ['.git'], ['node_modules'], ['dist/Profiles'], ['.zotero'], ['Zotero'], ['.env'], ['private.pem'], ['dist', 'dist/native.mjs'], ['dist', 'dist']]) {
  await assert.rejects(matrixFixture({ nativeTools }));
 }
});
test('nativeTools is v2-only and validates before generated output exists', async () => {
 const { config } = await matrixFixture({ nativeTools: ['dist/native.mjs'] }); assert.deepEqual(config.nativeTools, ['dist/native.mjs']);
 const root = await fixture(), path = join(root, '.github/zotero-plugin.json');
 const legacy = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; legacy.nativeTools = ['dist'];
 await writeFile(path, JSON.stringify(legacy)); await assert.rejects(loadConfig(root), /Unknown/);
});
test('staging rejects a declared missing path before writing any transport output', async () => {
 const { root } = await matrixFixture(); const output = join(root, 'transport');
 await assert.rejects(stageNativeTools(root, ['dist/missing.mjs'], output), /ENOENT/); await assert.rejects(access(output));
});
test('staging rejects symlinked components and nested links without traversing their targets', async () => {
 const { root } = await matrixFixture(), outside = await mkdtemp(join(tmpdir(), 'native-outside-'));
 await writeFile(join(outside, 'native.mjs'), 'outside'); await symlink(outside, join(root, 'linked'));
 await assert.rejects(stageNativeTools(root, ['linked/native.mjs'], join(root, 'first')), /[Ss]ymbolic/);
 await mkdir(join(root, 'dist')); await symlink(join(outside, 'native.mjs'), join(root, 'dist/native.mjs'));
 await assert.rejects(stageNativeTools(root, ['dist'], join(root, 'second')), /[Ss]ymbolic/);
});
test('staging rejects nested excluded content rather than silently omitting it', async () => {
 const { root } = await matrixFixture(); await mkdir(join(root, 'dist/node_modules'), { recursive: true });
 await writeFile(join(root, 'dist/node_modules/private.mjs'), 'private');
 await assert.rejects(stageNativeTools(root, ['dist'], join(root, 'transport')), /[Ff]orbidden/);
});
test('staging CLI reports explicit artifact presence and absence through GITHUB_OUTPUT', async () => {
 const { fileURLToPath } = await import('node:url');
 const script = fileURLToPath(new URL('../scripts/native-tools.mts', import.meta.url));
 for (const configured of [false, true]) {
  const { root } = await matrixFixture(configured ? { nativeTools: ['dist/native.mjs'] } : {});
  if (configured) { await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/native.mjs'), 'export {};'); }
  const output = join(root, 'github-output');
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', script, root, join(root, 'staging')], { env: { ...process.env, GITHUB_OUTPUT: output } });
  assert.equal(await readFile(output, 'utf8'), `present=${configured}\n`);
 }
});
