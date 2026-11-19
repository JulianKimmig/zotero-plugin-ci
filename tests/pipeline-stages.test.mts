/** Real-file aggregation tests prove missing evidence blocks publication metadata. */
import { nativeResult } from './native-result-fixture.mts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, archive } from './core-fixture.mts';
import { loadConfig } from '../src/config.mts';
import { inspectArtifact } from '../src/artifact.mts';
import { aggregateStage } from '../src/pipeline-stages.mts';
import { bindReceipt } from '../src/pipeline-receipts.mts';
import type { BuildState } from '../src/pipeline-stages.mts';
test('aggregate writes accepted bytes only after every bound native receipt succeeds', async () => {
 const root = await fixture(), config = await loadConfig(root), xpi = await archive(root);
 const accepted = await inspectArtifact(xpi, config, '0.1.0');
 const state: BuildState = { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1', metadataSHA256: 'f'.repeat(64), version: '0.1.0', xpiSHA256: accepted.sha256,
  previousSHA256: null, cells: [{ id: 'stable-linux-x64', version: '10.0.7', platform: 'linux-x64', sha256: 'a'.repeat(64) }],
  config, artifact: accepted, previousFeed: null, xpi: 'example-0.1.0.xpi' };
 const input = await mkdtemp(join(tmpdir(), 'pipeline-input-')), output = join(input, 'accepted');
 await writeFile(join(input, state.xpi), await import('node:fs/promises').then(fs => fs.readFile(xpi)));
 await assert.rejects(aggregateStage(state, input, [], output), /Missing/);
 await assert.rejects(access(join(output, 'accepted.json')));
 const receipt = bindReceipt(state, state.cells[0]!, { ...nativeResult(accepted.sha256, null, '0.1.0'), fresh: { ...(nativeResult(accepted.sha256, null, '0.1.0').fresh as object) } });
 await aggregateStage(state, input, [receipt], output);
 await access(join(output, 'accepted.json'));
});
test('aggregate rejects XPI mutation even with otherwise matching receipts', async () => {
 const root = await fixture(), config = await loadConfig(root), xpi = await archive(root), artifact = await inspectArtifact(xpi, config, '0.1.0');
 const state: BuildState = { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1', metadataSHA256: 'f'.repeat(64), version: '0.1.0', xpiSHA256: artifact.sha256, previousSHA256: null,
 cells: [{ id: 'linux', version: '10.0.7', platform: 'linux-x64', sha256: 'a'.repeat(64) }], config, artifact, previousFeed: null, xpi: 'changed.xpi' };
 const receipt = bindReceipt(state, state.cells[0]!, nativeResult(artifact.sha256, null, '0.1.0'));
 await writeFile(join(root, state.xpi), 'changed');
 await assert.rejects(aggregateStage(state, root, [receipt], join(root, 'out')), /digest/);
});
test('build rejects a packaged feed URL that differs from the otherwise correct source manifest', async () => {
 const { mkdir, readFile } = await import('node:fs/promises');
 const { buildStage } = await import('../src/pipeline-stages.mts');
 const root = await fixture(), config = await loadConfig(root), manifestPath = join(root, config.versions.manifest);
 const original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original) as { applications: { zotero: { update_url: string } } };
 manifest.applications.zotero.update_url = 'https://example.org/wrong-updates.json';
 await writeFile(manifestPath, JSON.stringify(manifest)); await archive(root); await writeFile(manifestPath, original);
 await writeFile(join(root, 'check.mjs'), '/** Fixture validation succeeds. */');
 await writeFile(join(root, 'build.mjs'), '/** Fixture packager retains its prebuilt bytes. */\nimport { copyFileSync } from "node:fs"; copyFileSync("plugin.xpi", process.argv[process.argv.indexOf("--output") + 1]);');
 const output = join(root, 'built'); await mkdir(output);
 await assert.rejects(buildStage(root, output, config, '0.1.0', 'example/plugin'), /update|URL/i);
});
test('aggregate rejects an unchanged candidate archive containing a different feed URL', async () => {
 const { readFile } = await import('node:fs/promises');
 const root = await fixture(), config = await loadConfig(root), manifestPath = join(root, config.versions.manifest);
 const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { applications: { zotero: { update_url: string } } };
 manifest.applications.zotero.update_url = 'https://example.org/wrong-updates.json'; await writeFile(manifestPath, JSON.stringify(manifest));
 const xpi = await archive(root), artifact = await inspectArtifact(xpi, config, '0.1.0');
 const state: BuildState = { repo: 'example/plugin', commit: 'b'.repeat(40), run: '1:1', metadataSHA256: 'f'.repeat(64), version: '0.1.0', xpiSHA256: artifact.sha256,
  previousSHA256: null, cells: [{ id: 'linux', version: '10.0.7', platform: 'linux-x64', sha256: 'a'.repeat(64) }], config, artifact, previousFeed: null, xpi: 'plugin.xpi' };
 const receipt = bindReceipt(state, state.cells[0]!, nativeResult(artifact.sha256, null, '0.1.0'));
 await assert.rejects(aggregateStage(state, root, [receipt], join(root, 'accepted')), /update|URL/i);
});
