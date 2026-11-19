/** Minimal GitHub REST transport. Tokens never enter errors or command lines. */
export class GitHub {
  private token: string;
  private transport: typeof fetch;
  /** Construct a transport with an installation or job token and optional HTTP boundary. */
  constructor(token: string, transport: typeof fetch = fetch) {
    if (!token) throw new Error('GitHub token required');
    this.token = token;
    this.transport = transport;
  }
  /** Send a REST request; return decoded JSON, binary bytes, or undefined for 204. */
  async request<T = unknown>(method: string, path: string, body?: unknown, binary = false): Promise<T> {
    const url = new URL(path, 'https://api.github.com');
    if (!['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.protocol !== 'https:') {
      throw new Error('Untrusted GitHub API origin');
    }
    const response = await this.transport(url, {
      method, headers: { authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28',
        accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' },
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body) }),
      redirect: binary ? 'follow' : 'error',
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${url.pathname}: ${response.status}`);
    if (response.status === 204) return undefined as T;
    return (binary ? Buffer.from(await response.arrayBuffer()) : await response.json()) as T;
  }
  /** Read all paginated REST list results; return the concatenated typed items. */
  async list<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page++) {
      const items = await this.request<T[]>('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      result.push(...items);
      if (items.length < 100) return result;
    }
  }
}
