/** Publish immutable, prebuilt release assets with conflict-safe retries. */
import { createHash } from 'node:crypto';
import { GitHub } from './github.mts';
/** Exact bytes and digest accepted by the build/native validation job. */
export interface ReleaseAsset { name: string; bytes: Uint8Array; sha256: string }
/** Publication identity and accepted assets. */
export interface Publication { repo: string; commit: string; version: string; assets: ReleaseAsset[] }
interface Release { id: number; draft: boolean; prerelease: boolean; tag_name: string; target_commitish: string; assets: { id: number; name: string }[] }
/** Compute the SHA256 of accepted or downloaded bytes. */
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Ensure a tag points directly to the tested commit; never overwrite conflicting refs. */
async function ensureTag(api: GitHub, root: string, tag: string, commit: string): Promise<void> {
  let ref: { object: { sha: string; type: string } };
  try { ref = await api.request('GET', `${root}/git/ref/tags/${tag}`); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.endsWith(': 404')) throw error;
    await api.request('POST', `${root}/git/refs`, { ref: `refs/tags/${tag}`, sha: commit });
    return;
  }
  if (ref.object.sha !== commit || ref.object.type !== 'commit') throw new Error('Conflicting release tag');
}
/** Upload missing assets, verify all remote bytes, then atomically publish as latest. */
export async function publishRelease(api: GitHub, input: Publication): Promise<void> {
  const { repo, commit, version, assets } = input;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid publication identity');
  const names = new Set<string>();
  for (const asset of assets) {
    if (!/^[\w.-]+$/.test(asset.name) || names.has(asset.name) || digest(asset.bytes) !== asset.sha256) throw new Error('Invalid accepted asset');
    names.add(asset.name);
  }
  if (assets.length === 0) throw new Error('No accepted assets');
  const root = `/repos/${repo}`;
  const tag = `v${version}`;
  await ensureTag(api, root, tag, commit);
  let release: Release;
  try { release = await api.request('GET', `${root}/releases/tags/${tag}`); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.endsWith(': 404')) throw error;
    release = await api.request('POST', `${root}/releases`, { tag_name: tag, target_commitish: commit, name: tag, draft: true, prerelease: true });
  }
  if (release.tag_name !== tag || release.target_commitish !== commit) throw new Error('Conflicting release identity');
  if (release.assets.some(asset => !names.has(asset.name))) throw new Error('Unexpected release asset');
  for (const asset of assets) {
    let remote = release.assets.find(item => item.name === asset.name);
    if (!remote) {
      if (!release.draft) throw new Error('Published release is missing an accepted asset');
      remote = await api.request('POST', `https://uploads.github.com${root}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, asset.bytes);
    }
    const downloaded = await api.request<Buffer>('GET', `${root}/releases/assets/${remote!.id}`, undefined, true);
    if (digest(downloaded) !== asset.sha256) throw new Error(`conflicting asset: ${asset.name}`);
  }
  if (release.draft || release.prerelease) {
    await api.request('PATCH', `${root}/releases/${release.id}`, { draft: false, prerelease: false, make_latest: 'true' });
  }
}
