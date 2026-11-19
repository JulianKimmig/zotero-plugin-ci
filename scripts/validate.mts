/** Build once, validate exact XPI natively, and emit accepted publication metadata. */
import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config.mts';
import { readVersion, assertPredecessor } from '../src/versions.mts';
import { inspectArtifact, createUpdateFeed } from '../src/artifact.mts';
import { installRuntime } from '../src/runtime.mts';
import { runScript } from '../src/runtime-adapter.mts';
import { selectBaseline, verifyPreviousHash } from '../src/github-baseline.mts';
import { buildBootstrap } from '../src/runtime-bootstrap.mts';
import { GitHub } from '../src/github.mts';
import type { UpdateFeed } from '../src/contracts.mts';
const root = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? join(root, '.ci-accepted'));
const config = await loadConfig(root);
if (process.versions.node !== config.nodeVersion) throw new Error('Node version does not match config');
const version = await readVersion(root, config);
await mkdir(output, { recursive: false });
const repo = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA;
if (!repo || !commit) throw new Error('GITHUB_REPOSITORY and GITHUB_SHA required');
const api = new GitHub(process.env.GITHUB_TOKEN ?? '');
let previousFeed: UpdateFeed | null = null;
let previous: string | undefined;
const releases = await api.list<{ draft: boolean; prerelease: boolean; tag_name: string; assets: { id: number; name: string }[] }>(`/repos/${repo}/releases`);
const baseline = selectBaseline(releases, version);
if (baseline) {
  const feed = baseline.assets.find(item => item.name === 'updates.json');
  const xpi = baseline.assets.find(item => item.name.endsWith('.xpi'));
  if (!feed || !xpi) throw new Error('Published baseline assets missing');
  previousFeed = JSON.parse((await api.request<Buffer>('GET', `/repos/${repo}/releases/assets/${feed.id}`, undefined, true)).toString()) as UpdateFeed;
  previous = join(output, 'previous.xpi');
  await writeFile(previous, await api.request<Buffer>('GET', `/repos/${repo}/releases/assets/${xpi.id}`, undefined, true));
  const entry = previousFeed.addons[config.plugin.id]?.updates.find(item => item.version === baseline.tag_name.slice(1));
  if (!entry) throw new Error('Previous version absent from published feed');
  verifyPreviousHash(await readFile(previous), entry.update_hash);
  await inspectArtifact(previous, config, baseline.tag_name.replace(/^v/, ''));
} else if (config.bootstrap) {
  assertPredecessor(config.bootstrap.version, version);
  previous = join(output, 'previous.xpi');
  await buildBootstrap(root, config.bootstrap, previous, config);
}
await runScript(root, config.scripts.validate, []);
const xpi = join(output, `${config.plugin.slug}-${version}.xpi`);
await runScript(root, config.scripts.build, ['--output', xpi]);
const accepted = await inspectArtifact(xpi, config, version);
const executable = await installRuntime(config.runtime, join(output, 'runtime'));
await runScript(root, config.scripts.native, ['--xpi', xpi, ...(previous ? ['--previous', previous] : [])], { ...process.env, ZOTERO_BIN: executable });
if ((await inspectArtifact(xpi, config, version)).sha256 !== accepted.sha256) throw new Error('Native validation modified XPI');
const manifest = JSON.parse(await readFile(join(root, config.versions.manifest), 'utf8')) as { applications: { zotero: { update_url: string } } };
if (manifest.applications.zotero.update_url !== `https://github.com/${repo}/releases/latest/download/updates.json`) throw new Error('Manifest requires stable release feed URL');
const feed = Buffer.from(JSON.stringify(createUpdateFeed(config, version, accepted.sha256, repo, previousFeed), null, 2) + '\n');
await writeFile(join(output, 'updates.json'), feed);
const release = Buffer.from(JSON.stringify({ repo, commit, ...accepted }, null, 2) + '\n');
await writeFile(join(output, 'release.json'), release);
const sums = Buffer.from(`${accepted.sha256}  ${config.plugin.slug}-${version}.xpi\n${createHash('sha256').update(feed).digest('hex')}  updates.json\n${createHash('sha256').update(release).digest('hex')}  release.json\n`);
await writeFile(join(output, 'SHA256SUMS'), sums);
await writeFile(join(output, 'accepted.json'), JSON.stringify({ repo, commit, version, assets: [
  { name: 'release.json', sha256: createHash('sha256').update(release).digest('hex') },
  { name: 'SHA256SUMS', sha256: createHash('sha256').update(sums).digest('hex') },
  { name: `${config.plugin.slug}-${version}.xpi`, sha256: accepted.sha256 },
  { name: 'updates.json', sha256: createHash('sha256').update(feed).digest('hex') },
] }, null, 2));
