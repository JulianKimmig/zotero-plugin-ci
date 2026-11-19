/** Recheck legacy accepted bytes/source without inventing matrix or runtime observation receipts. */
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import { hashFile, readJSON } from '../src/pipeline-io.mts';
const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
const metadata = await readJSON(join(input, 'accepted.json')) as { repo: string; commit: string; assets: { name: string; sha256: string }[] };
assert.equal(metadata.repo, process.env.GITHUB_REPOSITORY); assert.equal(metadata.commit, process.env.GITHUB_SHA);
assert.ok(metadata.assets.length > 0 && new Set(metadata.assets.map(asset => asset.name)).size === metadata.assets.length, 'Missing or duplicate legacy assets');
for (const asset of metadata.assets) {
 assert.match(asset.name, /^[\w.-]+$/); assert.match(asset.sha256, /^[a-f0-9]{64}$/);
 assert.equal(await hashFile(join(input, asset.name)), asset.sha256, 'Legacy accepted asset digest mismatch');
}
await mkdir(output, { recursive: false });
for (const name of ['accepted.json', ...metadata.assets.map(asset => asset.name)]) await copyFile(join(input, name), join(output, name));
