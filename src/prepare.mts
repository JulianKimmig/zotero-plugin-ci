/** Metadata-only promotion guards and compare-and-swap Git tree writes. */
import { GitHub } from './github.mts';
/** GitHub pull-request metadata used by the promotion policy. */
export interface Promotion {
  number: number; state: string;
  head: { ref: string; sha: string; repo: { full_name: string } };
  base: { ref: string; sha: string }; labels: { name: string }[];
}
/** Require a unique open develop-to-main promotion in the same repository. */
export function assertPromotion(pr: Promotion, repo: string, open: Promotion[]): void {
  if (pr.state !== 'open' || pr.head.ref !== 'develop' || pr.base.ref !== 'main' || pr.head.repo.full_name !== repo) {
    throw new Error('Only same-repository develop to main promotions may update versions');
  }
  if (open.filter(item => item.base.ref === 'main' && item.head.ref === 'develop').length !== 1) {
    throw new Error('Exactly one promotion must be open');
  }
}
/** Require the computed target and a published baseline at the preceding main commit. */
export function assertVersionCheck(actual: string, expected: string, publishedCommit: string, mainCommit: string): void {
  if (actual !== expected) throw new Error(`Version must be ${expected}, received ${actual}`);
  if (publishedCommit !== mainCommit) throw new Error('Published baseline must identify preceding main');
}
/** Write JSON-only version changes in one commit after rechecking PR head and base. */
export async function writeVersions(api: GitHub, repo: string, original: Promotion, files: Record<string, string>): Promise<string> {
  const current = await api.request<Promotion>('GET', `/repos/${repo}/pulls/${original.number}`);
  assertPromotion(current, repo, await api.list<Promotion>(`/repos/${repo}/pulls?state=open&base=main`));
  if (current.head.sha !== original.head.sha || current.base.sha !== original.base.sha) throw new Error('Promotion changed during preparation');
  if (Object.keys(files).length === 0) return original.head.sha;
  const parent = await api.request<{ tree: { sha: string } }>('GET', `/repos/${repo}/git/commits/${original.head.sha}`);
  const tree: { path: string; mode: string; type: string; content: string }[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.json') || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Only safe JSON version files may be written');
    JSON.parse(content);
    tree.push({ path, mode: '100644', type: 'blob', content });
  }
  const created = await api.request<{ sha: string }>('POST', `/repos/${repo}/git/trees`, { base_tree: parent.tree.sha, tree });
  const commit = await api.request<{ sha: string }>('POST', `/repos/${repo}/git/commits`, {
    message: 'chore: prepare release versions', tree: created.sha, parents: [original.head.sha],
  });
  const latest = await api.request<Promotion>('GET', `/repos/${repo}/pulls/${original.number}`);
  if (latest.head.sha !== original.head.sha || latest.base.sha !== original.base.sha) throw new Error('Promotion changed before ref update');
  await api.request('PATCH', `/repos/${repo}/git/refs/heads/develop`, { sha: commit.sha, force: false });
  return commit.sha;
}
/** Upsert the stable required check for a specific immutable head commit. */
export async function versionCheck(api: GitHub, repo: string, head: string, success: boolean, summary: string): Promise<void> {
  const existing = await api.request<{ check_runs: { id: number; name: string }[] }>('GET', `/repos/${repo}/commits/${head}/check-runs?check_name=release-version&filter=latest`);
  const check = existing.check_runs.find(item => item.name === 'release-version');
  const body = { name: 'release-version', head_sha: head, status: 'completed', conclusion: success ? 'success' : 'failure', output: { title: 'Release version', summary } };
  await api.request(check ? 'PATCH' : 'POST', `/repos/${repo}/check-runs${check ? `/${check.id}` : ''}`, body);
}
