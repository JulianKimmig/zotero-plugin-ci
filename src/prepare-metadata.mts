/** Snapshot only JSON metadata from immutable refs; never checkout or execute PR code. */
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPublicAssets } from './publish-public.mts';
import { GitHub } from './github.mts';
import { loadConfig } from './config.mts';
import { readVersion, nextVersion, prepareVersions } from './versions.mts';
import { assertPromotion, assertVersionCheck, versionCheck, writeVersions } from './prepare.mts';
import type { PluginConfig } from './contracts.mts';
import type { Promotion } from './prepare.mts';
/** Download one safe JSON blob from an immutable source ref, returning its text. */
async function jsonFile(api: GitHub, repo: string, ref: string, path: string): Promise<string> {
  if (!path.endsWith('.json') || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Unsafe metadata path');
  const blob = await api.request<{ type: string; encoding: string; content: string }>('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
  if (blob.type !== 'file' || blob.encoding !== 'base64') throw new Error('Metadata must be a regular JSON blob');
  const text = Buffer.from(blob.content, 'base64').toString('utf8');
  JSON.parse(text);
  return text;
}
/** Download the config and its declared version JSONs without running npm or plugin code. */
async function snapshot(api: GitHub, repo: string, ref: string, legacyConfig?: PluginConfig): Promise<{ root: string; legacy: boolean }> {
  const root = await mkdtemp(join(tmpdir(), 'zotero-metadata-'));
  let config: string;
  let legacy = false;
  try { config = await jsonFile(api, repo, ref, '.github/zotero-plugin.json'); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.endsWith(': 404') || legacyConfig?.bootstrap?.commit !== ref) throw error;
    legacy = true;
    config = JSON.stringify(legacyConfig);
  }
  const raw = JSON.parse(config) as { versions: Record<string, string> };
  const files = new Map<string, string>(legacy ? [] : [['.github/zotero-plugin.json', config]]);
  for (const path of new Set(Object.values(raw.versions))) files.set(path, await jsonFile(api, repo, ref, path));
  for (const [path, text] of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return { root, legacy };
}
/** Prepare version-only changes and upsert the required check for the resulting head. */
export async function preparePromotion(api: GitHub, repo: string, number: number, publicTransport: typeof fetch = fetch): Promise<void> {
  const pr = await api.request<Promotion>('GET', `/repos/${repo}/pulls/${number}`);
  let head = pr.head.sha;
  try {
    assertPromotion(pr, repo, await api.list<Promotion>(`/repos/${repo}/pulls?state=open&base=main`));
    const { root: source } = await snapshot(api, repo, head);
    const config = await loadConfig(source);
    const { root: base, legacy } = await snapshot(api, repo, pr.base.sha, config);
    const baseConfig = legacy ? config : await loadConfig(base);
    // Pin metadata paths to main; PRs cannot redirect privileged writes to other JSON files.
    if (JSON.stringify(config.versions) !== JSON.stringify(baseConfig.versions)) throw new Error('Version paths must match main');
    const baseline = await readVersion(base, baseConfig);
    const releases = await api.list<{ draft: boolean; prerelease: boolean; tag_name: string; assets: { id: number; name: string }[] }>(`/repos/${repo}/releases`);
    if (legacy && releases.some(item => !item.draft && !item.prerelease)) throw new Error('Legacy adoption requires no published stable release');
    const published = releases.find(item => !item.draft && !item.prerelease && item.tag_name === `v${baseline}`);
    let baselineCommit: string;
    if (published) {
      const assets = [];
      for (const asset of published.assets) {
        const bytes = await api.request<Buffer>('GET', `/repos/${repo}/releases/assets/${asset.id}`, undefined, true);
        assets.push({ name: asset.name, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      await verifyPublicAssets(repo, baseline, assets, publicTransport);
      const ref = await api.request<{ object: { sha: string; type: string } }>('GET', `/repos/${repo}/git/ref/tags/v${baseline}`);
      if (ref.object.type !== 'commit') throw new Error('Baseline tag must point directly to commit');
      baselineCommit = ref.object.sha;
    } else {
      if (releases.some(item => !item.draft && !item.prerelease)) throw new Error('Missing published baseline');
      if (baseConfig.bootstrap) {
        if (baseConfig.bootstrap.version !== baseline) throw new Error('Bootstrap version must match main baseline');
        baselineCommit = baseConfig.bootstrap.commit;
      } else {
        if (legacy) throw new Error('Legacy adoption requires an explicit bootstrap');
        baselineCommit = pr.base.sha;
      }
    }
    const expected = nextVersion(baseline, pr.labels.map(item => item.name));
    assertVersionCheck(expected, expected, baselineCommit, pr.base.sha);
    const changed = await prepareVersions(source, config, expected);
    const files: Record<string, string> = {};
    for (const path of changed) files[path] = await readFile(join(source, path), 'utf8');
    head = await writeVersions(api, repo, pr, files);
    assertVersionCheck(await readVersion(source, config), expected, baselineCommit, pr.base.sha);
    await versionCheck(api, repo, head, true, `Prepared ${expected} from main baseline ${baseline} at ${baselineCommit}`);
  } catch (error) {
    await versionCheck(api, repo, head, false, error instanceof Error ? error.message : 'Preparation failed');
    throw error;
  }
}
