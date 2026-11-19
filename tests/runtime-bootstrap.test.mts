/** Real pre-CI Git/npm bootstrap fixtures; no historical config or CI adapters. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
import { buildBootstrap } from '../src/runtime-bootstrap.mts';
import { inspectArtifact } from '../src/artifact.mts';
const exec = promisify(execFile);
/** Create a committed historical package exposing only npm build; return current config and source identity. */
async function legacy(build = true, version = '0.1.0') {
  const current = await fixture();
  const config = await loadConfig(current);
  const root = await mkdtemp(join(tmpdir(), 'legacy-bootstrap-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'legacy', version, scripts: build ? { build: 'node build.mjs' } : {} }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'legacy', version, lockfileVersion: 3, packages: { '': { name: 'legacy', version } } }));
  const manifest = JSON.parse(await readFile(join(current, 'manifest.json'), 'utf8'));
  manifest.version = version;
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'bootstrap.js'), '/** Legacy plugin. */');
  await writeFile(join(root, 'LICENSE'), 'MIT fixture');
  await writeFile(join(root, 'build.mjs'), `import { execFileSync } from 'node:child_process';
const output = process.argv[process.argv.indexOf('--output') + 1];
execFileSync('zip', ['-q', '-X', output, 'manifest.json', 'bootstrap.js', 'LICENSE']);`);
  await exec('git', ['init', '--initial-branch=main', root]);
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture baseline']);
  const { stdout } = await exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const output = join(await mkdtemp(join(tmpdir(), 'legacy-output-')), 'previous.xpi');
  return { root, config, output, baseline: { version: '0.1.0', commit: stdout.trim() } };
}
test('builds historical npm build without CI config and preserves current source', async () => {
  const item = await legacy();
  const before = await readFile(join(item.root, 'package.json'), 'utf8');
  await buildBootstrap(item.root, item.baseline, item.output, item.config);
  assert.equal((await inspectArtifact(item.output, item.config, '0.1.0')).version, '0.1.0');
  assert.equal(await readFile(join(item.root, 'package.json'), 'utf8'), before);
  await assert.rejects(access(join(item.root, '.github')));
});
test('rejects a historical source version mismatch before building', async () => {
  const item = await legacy(true, '0.2.0');
  await assert.rejects(buildBootstrap(item.root, item.baseline, item.output, item.config), /Bootstrap source version mismatch/);
  await assert.rejects(access(item.output));
});
test('requires the explicit historical build script', async () => {
  const item = await legacy(false);
  await assert.rejects(buildBootstrap(item.root, item.baseline, item.output, item.config));
  await assert.rejects(access(item.output));
});
test('bootstrap preserves historical installation bounds when the current plugin broadens compatibility', async () => {
  const item = await legacy();
  const { plugin, nodeVersion, versions, scripts } = item.config;
  const config = { schemaVersion: 2 as const, plugin, nodeVersion, versions, scripts,
    compatibility: { min: '10.0.7', max: '10.*' }, targets: ['10.latest.latest'], platforms: ['linux-x64' as const] };
  await buildBootstrap(item.root, item.baseline, item.output, config);
  const prior = await inspectArtifact(item.output, config, item.baseline.version, { historical: true });
  assert.deepEqual(prior.compatibility, { min: '10.0.7', max: '10.0.7' });
  await assert.rejects(inspectArtifact(item.output, config, item.baseline.version), /compatibility/);
});
