/** Verify anonymously downloadable release bytes and the stable latest feed. */
import { createHash } from 'node:crypto';
/** Fetch each immutable release asset and latest feed without credentials; require accepted SHA256 values. */
export async function verifyPublicAssets(repo: string, version: string, assets: { name: string; sha256: string }[], transport: typeof fetch = fetch): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid public release identity');
  const feed = assets.find(asset => asset.name === 'updates.json');
  if (!feed) throw new Error('Published baseline has no update feed');
  const downloads = assets.map(asset => ({ ...asset, url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(asset.name)}` }));
  downloads.push({ ...feed, url: `https://github.com/${repo}/releases/latest/download/updates.json` });
  for (const asset of downloads) {
    const response = await transport(asset.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Public download ${asset.name}: ${response.status}`);
    const hash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    if (hash !== asset.sha256) throw new Error(`Public hash mismatch: ${asset.name}`);
  }
}
