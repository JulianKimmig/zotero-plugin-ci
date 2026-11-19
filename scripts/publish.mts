/** Isolated publication entrypoint: reads only accepted bytes and JSON metadata. */
import { resolve, join } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { verifyPublicAssets } from '../src/publish-public.mts';
import { GitHub } from '../src/github.mts';
import { publishRelease } from '../src/publish.mts';
const root = resolve(process.argv[2] ?? '.ci-accepted');
const metadata = JSON.parse(await readFile(join(root, 'accepted.json'), 'utf8')) as {
  repo: string; commit: string; version: string; assets: { name: string; sha256: string }[];
};
if (metadata.repo !== process.env.GITHUB_REPOSITORY || metadata.commit !== process.env.GITHUB_SHA) throw new Error('Accepted metadata does not match workflow source');
const assets = [];
for (const asset of metadata.assets) {
  if (!/^[\w.-]+$/.test(asset.name)) throw new Error('Unsafe asset name');
  const path = join(root, asset.name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Asset must be regular file');
  assets.push({ ...asset, bytes: await readFile(path) });
}
await publishRelease(new GitHub(process.env.GITHUB_TOKEN ?? ''), { ...metadata, assets });

try { await verifyPublicAssets(metadata.repo, metadata.version, metadata.assets); }
catch (error) { throw new Error('Release is published but public readback failed; keep promotion blocked and retry verification', { cause: error }); }
