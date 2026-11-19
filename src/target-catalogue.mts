/** Capture official Zotero tags once and derive fixed official platform archive names. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fields, object, text } from './validation.mts';
import type { CataloguePage, Platform, ResolutionSource } from './contracts.mts';
import { nativeParts, compareNative } from './native-versions.mts';

/** Public official tag catalogue endpoint, with explicit stable pagination. */
export const CATALOGUE_URL = 'https://api.github.com/repos/zotero/zotero/tags?per_page=100&page=1';

/** Hash a deterministic JSON identity. @param value Captured identity. @returns Lowercase digest. */
export function identityHash(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Validate a catalogue URL scoped to Zotero's exact repository identity. @param value Public URL. @param page Expected sequential page. @returns Original validated URL. */
function catalogueURL(value: string, page: number): string {
  const url = new URL(value);
  assert.equal(url.origin, 'https://api.github.com');
  assert.ok(['/repos/zotero/zotero/tags', '/repositories/2656556/tags'].includes(url.pathname), 'Unexpected catalogue repository');
  assert.ok(!url.username && !url.password && !url.hash);
  assert.equal(url.searchParams.get('page'), String(page), 'Unexpected catalogue page');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['page', 'per_page']);
  return value;
}

/** Admit a persisted public catalogue snapshot and its per-tag commit identities. @param value External pages. @returns Detached validated snapshot. */
export function catalogueSnapshot(value: unknown): CataloguePage[] {
  assert.ok(Array.isArray(value) && value.length > 0, 'Missing captured catalogue');
  return value.map((entry, index) => {
    const page = fields(entry, ['url', 'tags']), url = catalogueURL(text(page.url), index + 1);
    assert.ok(Array.isArray(page.tags));
    const tags = page.tags.map(value => {
      const tag = fields(value, ['name', 'commit']);
      return { name: text(tag.name), commit: text(tag.commit, /^[a-f0-9]{40}$/) };
    });
    return { url, tags };
  });
}

/** Capture all linked official tag pages once, failing on malformed/error metadata. @param request External HTTP transport. @param token Optional caller-supplied GitHub token, scoped exclusively to validated catalogue URLs. @returns Sorted stable names and catalogue identity. */
export async function captureCatalogue(request: typeof fetch, token?: string): Promise<{ versions: string[]; source: ResolutionSource }> {
  let url: string | undefined = CATALOGUE_URL;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token !== undefined) headers.Authorization = `Bearer ${text(token, /^\S+$/)}`;
  const pages: CataloguePage[] = [], seen = new Set<string>();
  while (url) {
    catalogueURL(url, pages.length + 1);
    assert.ok(!seen.has(url), 'Repeated catalogue page'); seen.add(url);
    const response: Response = await request(url, { headers, redirect: 'error' });
    assert.ok(response.ok, `Catalogue HTTP ${response.status}`);
    const raw: unknown = await response.json(); assert.ok(Array.isArray(raw), 'Expected tag catalogue array');
    const tags = raw.map(value => {
      const tag = object(value);
      return { name: text(tag.name), commit: text(object(tag.commit).sha, /^[a-f0-9]{40}$/) };
    }); pages.push({ url, tags });
    const link: string | null = response.headers.get('link'); url = undefined;
    if (link) {
      const links = link.split(',');
      for (const entry of links) {
        const match = entry.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
        assert.ok(match, 'Malformed catalogue pagination');
        if (match[2] !== 'next') continue;
        assert.equal(url, undefined, 'Duplicate next page'); url = catalogueURL(match[1], pages.length + 1);
      }
    }
  }
  const versions = [...new Set(pages.flatMap(page => page.tags.map(tag => tag.name)))].filter(name => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(name)) return false;
    nativeParts(name); return true;
  }).sort((a, b) => compareNative(b, a) || b.length - a.length || a.localeCompare(b));
  return { versions, source: { kind: 'zotero-tags', url: CATALOGUE_URL, sha256: identityHash(pages), catalogue: pages } };
}

/** Derive only official release locations and known installed executables. @param version Original native release spelling. @param platform Supported OS/architecture. @returns Download and executable paths. */
export function officialRuntime(version: string, platform: Platform): { url: string; executable: string } {
  const [major] = nativeParts(version);
  assert.ok(major >= 7, 'Official matrix runtime archives require Zotero 7 or newer');
  const paths: Record<Platform, { suffix: string; executable: string }> = {
    'linux-x64': { suffix: `_linux-x86_64.tar.${major === 7 ? 'bz2' : 'xz'}`, executable: 'Zotero_linux-x86_64/zotero' },
    'windows-x64': { suffix: '_win-x64.zip', executable: 'Zotero_win-x64/zotero.exe' },
    'macos-x64': { suffix: '.dmg', executable: 'Zotero.app/Contents/MacOS/zotero' },
  };
  return { url: `https://download.zotero.org/client/release/${version}/Zotero-${version}${paths[platform].suffix}`, executable: paths[platform].executable };
}
