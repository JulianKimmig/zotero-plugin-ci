/** Short-lived, repository-scoped GitHub App authentication for preparation only. */
import { createSign } from 'node:crypto';
import { GitHub } from './github.mts';
/** Sign a nine-minute App JWT; input key stays in memory and never enters subprocesses. */
export function appJwt(id: string, key: string, now = Math.floor(Date.now() / 1000)): string {
  if (!/^\d+$/.test(id)) throw new Error('Invalid App ID');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: id })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${createSign('RSA-SHA256').update(message).sign(key).toString('base64url')}`;
}
/** Obtain a token restricted to one repository and contents, PR metadata and checks. */
export async function installationToken(id: string, key: string, repo: string): Promise<string> {
  const app = new GitHub(appJwt(id, key));
  const installation = await app.request<{ id: number }>('GET', `/repos/${repo}/installation`);
  const token = await app.request<{ token: string }>('POST', `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repo.split('/')[1]], permissions: { contents: 'write', pull_requests: 'read', checks: 'write' },
  });
  return token.token;
}
