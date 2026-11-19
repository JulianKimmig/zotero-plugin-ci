/** Ubuntu-only resolution, historical baseline capture and one-time frozen runtime provisioning. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginConfig, Resolution, ResolvedTarget, RuntimePin, UpdateFeed } from './contracts.mts';
import { loadConfig } from './config.mts';
import { readVersion, assertPredecessor } from './versions.mts';
import { resolveTargets } from './resolve-targets.mts';
import { officialRuntime } from './target-catalogue.mts';
import { freezeRuntime } from './runtime.mts';
import { inspectArtifact } from './artifact.mts';
import { buildBootstrap } from './runtime-bootstrap.mts';
import { selectBaseline, verifyPreviousHash } from './github-baseline.mts';
import { GitHub } from './github.mts';
import { nativeParts } from './native-versions.mts';
import { hashFile, readJSON, writeJSON } from './pipeline-io.mts';
import type { PipelineCell } from './pipeline-receipts.mts';
/** Frozen runtime transport descriptor; path is relative to its platform artifact. */
export interface FrozenRuntime extends RuntimePin { archive: string }
/** Attach an already frozen archive to a selector row, checking any replay digest before reuse. */
export function bindFrozenTarget(target: ResolvedTarget, pin: FrozenRuntime): FrozenRuntime {
 if (target.sha256) assert.equal(pin.sha256, target.sha256, 'Frozen runtime digest mismatch');
 target.sha256 = pin.sha256;
 return pin;
}
/** Prepared replay snapshot shared by build and native jobs; it contains no authentication data. */
export interface PreparedState {
 repo: string; commit: string; run: string; config: PluginConfig; version: string; resolution: Resolution;
 cells: PipelineCell[]; runtimes: Record<string, FrozenRuntime>; previousFeed: UpdateFeed | null; previousSHA256: string | null;
}
/** Test exact/native wildcard compatibility without conflating plugin and host versions. */
export function supports(version: string, bounds: { min: string; max: string }): boolean {
 const actual = nativeParts(version), lower = nativeParts(bounds.min);
 const upper = bounds.max.includes('*') ? bounds.max.split('.').map(part => part === '*' ? Infinity : Number(part)) : nativeParts(bounds.max);
 while (upper.length < 3) upper.push(Infinity);
 /** Compare admitted numeric native version tuples. */
 const compare = (left: number[], right: number[]): number => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
 return compare(actual, lower) >= 0 && compare(actual, upper) <= 0;
}
/** Resolve once and download each native version/platform archive once on the Linux preparation host. */
export async function prepareStage(root: string, output: string, identity: { repo: string; commit: string; run: string }, resolutionPath?: string): Promise<PreparedState> {
 const config = await loadConfig(root), version = await readVersion(root, config);
 assert.equal(process.versions.node, config.nodeVersion, 'Node version does not match config');
 await mkdir(output, { recursive: false });
 const token = process.env.GITHUB_TOKEN;
 const resolution = await resolveTargets(config, {
  ...(token ? { token } : {}),
  ...(resolutionPath ? { resolution: await readJSON(resolutionPath) } : {}),
 });
 const previousFeedAndPath = await baseline(root, output, config, version, identity.repo);
 const previous = previousFeedAndPath.version ? await inspectArtifact(join(output, 'previous.xpi'), config, previousFeedAndPath.version, { historical: true }) : null;
 const runtimes: Record<string, FrozenRuntime> = {};
 /** Freeze one unique archive; reused cells share its exact digest and relative archive name. */
 async function freeze(target: Resolution['targets'][number]): Promise<FrozenRuntime> {
  const key = `${target.version}-${target.platform}`;
  if (runtimes[key]) return bindFrozenTarget(target, runtimes[key]);
  assert.match(key, /^[\w.-]+$/);
  const directory = join(output, 'runtimes', target.platform); await mkdir(directory, { recursive: true });
  const archive = `${key}.archive`, pin = await freezeRuntime(target, join(directory, archive));
  runtimes[key] = { ...pin, archive };
  return bindFrozenTarget(target, runtimes[key]);
 }
 const cells: PipelineCell[] = [];
 for (const target of resolution.targets) {
  const current = await freeze(target);
  const cell: PipelineCell = { id: target.id, version: target.version, platform: target.platform, sha256: current.sha256 };
  if (previous) {
   const minimum = previous.compatibility.min;
   const version = minimum.split('.').length === 3 && minimum.endsWith('.0') ? minimum.slice(0, -2) : minimum;
   assert.ok(supports(version, previous.compatibility), 'Predecessor host outside historical compatibility');
   const pin = await freeze({ id: `${version}-${target.platform}`, selectors: [version], version, platform: target.platform, ...officialRuntime(version, target.platform) });
   cell.previousRuntime = { version: pin.version, sha256: pin.sha256 };
  }
  cells.push(cell);
 }
 const state: PreparedState = { ...identity, config, version, resolution, cells, runtimes, previousFeed: previousFeedAndPath.feed,
  previousSHA256: previous ? await hashFile(join(output, 'previous.xpi')) : null };
 await writeJSON(join(output, 'prepared.json'), state);
 return state;
}
/** Capture published baseline bytes/feed, or build the explicitly pinned bootstrap source on Ubuntu. */
async function baseline(root: string, output: string, config: PluginConfig, version: string, repo: string): Promise<{ feed: UpdateFeed | null; version?: string }> {
 const api = new GitHub(process.env.GITHUB_TOKEN ?? '');
 const releases = await api.list<{ draft: boolean; prerelease: boolean; tag_name: string; assets: { id: number; name: string }[] }>(`/repos/${repo}/releases`);
 const selected = selectBaseline(releases, version);
 if (selected) {
  const feeds = selected.assets.filter(asset => asset.name === 'updates.json'), xpis = selected.assets.filter(asset => asset.name.endsWith('.xpi'));
  assert.ok(feeds.length === 1 && xpis.length === 1, 'Published baseline assets missing or ambiguous');
  const feed = JSON.parse((await api.request<Buffer>('GET', `/repos/${repo}/releases/assets/${feeds[0].id}`, undefined, true)).toString()) as UpdateFeed;
  const bytes = await api.request<Buffer>('GET', `/repos/${repo}/releases/assets/${xpis[0].id}`, undefined, true);
  const previousVersion = selected.tag_name.slice(1), entry = feed.addons[config.plugin.id]?.updates.find(item => item.version === previousVersion);
  assert.ok(entry, 'Previous version absent from published feed'); verifyPreviousHash(bytes, entry.update_hash);
  await writeFile(join(output, 'previous.xpi'), bytes, { flag: 'wx' });
  return { feed, version: previousVersion };
 }
 if (config.bootstrap) {
  assertPredecessor(config.bootstrap.version, version);
  await buildBootstrap(root, config.bootstrap, join(output, 'previous.xpi'), config);
  return { feed: null, version: config.bootstrap.version };
 }
 return { feed: null };
}
