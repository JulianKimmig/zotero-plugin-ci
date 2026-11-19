/** Unprivileged build and aggregate operations for one immutable XPI across native jobs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginConfig, ArtifactInfo, UpdateFeed, Resolution } from './contracts.mts';
import { inspectArtifact, createUpdateFeed } from './artifact.mts';
import { runScript } from './runtime-adapter.mts';
import { hashFile, writeJSON } from './pipeline-io.mts';
import { aggregateReceipts, type PipelinePlan } from './pipeline-receipts.mts';
/** Build transport retains validated configuration and public history beside the immutable archive. */
export interface BuildState extends PipelinePlan { resolution?: Resolution; config: PluginConfig; artifact: ArtifactInfo; previousFeed: UpdateFeed | null; xpi: string }
/** Run consumer checks/build once, admitting the resulting archive and stable public update URL. */
export async function buildStage(root: string, output: string, config: PluginConfig, version: string, repo: string): Promise<ArtifactInfo> {
 await runScript(root, config.scripts.validate, []);
 const xpi = join(output, `${config.plugin.slug}-${version}.xpi`);
 await runScript(root, config.scripts.build, ['--output', xpi]);
 const artifact = await inspectArtifact(xpi, config, version, { updateURL: `https://github.com/${repo}/releases/latest/download/updates.json` });
 const manifest = JSON.parse(await readFile(join(root, config.versions.manifest), 'utf8')) as { applications: { zotero: { update_url: string } } };
 assert.equal(manifest.applications.zotero.update_url, `https://github.com/${repo}/releases/latest/download/updates.json`, 'Manifest requires stable release feed URL');
 return artifact;
}
/** Require complete matrix evidence and unchanged bytes before producing publication-only assets. */
export async function aggregateStage(state: BuildState, input: string, receipts: readonly unknown[], output: string): Promise<void> {
 const acceptedReceipts = aggregateReceipts(state, receipts);
 assert.match(state.xpi, /^[\w.-]+\.xpi$/, 'Unsafe XPI transport name');
 assert.equal(await hashFile(join(input, state.xpi)), state.xpiSHA256, 'Aggregate XPI digest mismatch');
 const inspected = await inspectArtifact(join(input, state.xpi), state.config, state.version, { updateURL: `https://github.com/${state.repo}/releases/latest/download/updates.json` });
 assert.deepEqual(inspected, state.artifact, 'Aggregate artifact observation mismatch');
 await mkdir(output, { recursive: false });
 await copyFile(join(input, state.xpi), join(output, state.xpi));
 const feed = createUpdateFeed(state.config, state.version, state.xpiSHA256, state.repo, state.previousFeed);
 await writeJSON(join(output, 'updates.json'), feed);
 await writeJSON(join(output, 'release.json'), { repo: state.repo, commit: state.commit, run: state.run, ...inspected, resolution: state.resolution, matrix: acceptedReceipts });
 const names = [state.xpi, 'updates.json', 'release.json'];
 const sums = (await Promise.all(names.map(async name => `${await hashFile(join(output, name))}  ${name}\n`))).join('');
 await writeFile(join(output, 'SHA256SUMS'), sums, { flag: 'wx' });
 names.push('SHA256SUMS');
 const assets = await Promise.all(names.map(async name => ({ name, sha256: await hashFile(join(output, name)) })));
 await writeJSON(join(output, 'accepted.json'), { repo: state.repo, commit: state.commit, version: state.version, assets });
}
/** Hash a stable JSON snapshot for source/config/resolution transport binding. */
export function snapshotHash(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
