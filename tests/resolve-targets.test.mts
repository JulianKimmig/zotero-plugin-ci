/** Resolver behavior against mocked external HTTP and real admitted plugin configurations. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './core-fixture.mts';
import { matrixFixture } from './matrix-fixture.mts';
import { loadConfig } from '../src/config.mts';
import { resolveTargets } from '../src/resolve-targets.mts';

/** Build a transport that captures official catalogue pages and archive requests. @param pages Tag pages. @param status Archive HTTP response. @returns Fetch-compatible external stub and requests. */
function transport(pages: string[][], status: (url: string) => number = () => 200,
  metadata: { cap?: string; changelog?: string } = {}): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  return { calls, fetch: async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.startsWith('https://www.zotero.org/download/client/version?')) return new Response(metadata.cap ?? '99.0');
    if (url.startsWith('https://raw.githubusercontent.com/zotero/zotero-docs/main/content/')) {
      return new Response(metadata.changelog ?? pages.flat().filter(name => /^\d+\.\d+(?:\.\d+)?$/.test(name))
        .map(name => `## Changes in ${name} (November 19, 2026)\n\n- Test release\n`).join('\n'));
    }
    if (url.startsWith('https://api.github.com/repos/zotero/zotero/tags?')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json((pages[page - 1] ?? []).map(name => ({ name, commit: { sha: 'a'.repeat(40) } })), { headers: page < pages.length
        ? { link: `<https://api.github.com/repos/zotero/zotero/tags?per_page=100&page=${page + 1}>; rel="next"` } : {} });
    }
    assert.equal(init?.method, 'HEAD'); assert.match(url, /^https:\/\/download\.zotero\.org\/client\/release\//);
    return new Response(null, { status: status(url) });
  } };
}

test('captures pagination once, sorts numerically, ignores unstable tags and deduplicates aliases', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.latest', '10.latest.latest', '10.0.10'] });
  const http = transport([['10.0.9', '10.0.10-beta', 'v10.0.10', 'bad'], ['10.0.10', '10.0']]);
  const resolution = await resolveTargets(config, { fetch: http.fetch, now: () => new Date('2026-11-19T10:00:00Z') });
  assert.equal(resolution.schemaVersion, 1); assert.equal(resolution.resolvedAt, '2026-11-19T10:00:00.000Z');
  assert.equal(resolution.targets.length, 3);
  assert.ok(resolution.targets.every(row => row.version === '10.0.10' && row.selectors.length === 3));
  assert.equal(http.calls.filter(url => url.includes('api.github.com')).length, 2);
  assert.equal(http.calls.filter(url => url.includes('download.zotero.org')).length, 3);
});

test('normalizes two-component comparisons while retaining actual release names', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.0', '10.0'], platforms: ['linux-x64'] });
  const resolution = await resolveTargets(config, { fetch: transport([['10.0']]).fetch });
  assert.equal(resolution.targets[0].version, '10.0');
  assert.match(resolution.targets[0].url, /\/10\.0\/Zotero-10\.0_linux-x86_64\.tar\.xz$/);
  assert.deepEqual(resolution.targets[0].selectors, ['10.0.0', '10.0']);
});

test('only an archive 404 permits selecting the next available stable version', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  const resolution = await resolveTargets(config, { fetch: transport([['10.0.10', '10.0.9']], url => url.includes('10.0.10') ? 404 : 200).fetch });
  assert.equal(resolution.targets[0].version, '10.0.9');
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(resolveTargets(config, { fetch: transport([['10.0.10', '10.0.9']], () => status).fetch }));
  }
});

test('metadata errors, missing exact releases, network errors and unavailable platforms fail', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  await assert.rejects(resolveTargets(config, { fetch: async () => new Response(null, { status: 500 }) }));
  await assert.rejects(resolveTargets(config, { fetch: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(resolveTargets(config, { fetch: transport([['10.0']], () => 404).fetch }));
  const exact = await matrixFixture({ targets: ['10.0.8'], platforms: ['linux-x64'] });
  await assert.rejects(resolveTargets(exact.config, { fetch: transport([['10.0.9']]).fetch }));
});

test('validates deterministic replay without HTTP and rejects altered rows or selectors', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  const resolution = await resolveTargets(config, { fetch: transport([['10.0.10']]).fetch });
  const offline: typeof fetch = async () => { throw new Error('Unexpected HTTP'); };
  assert.deepEqual(await resolveTargets(config, { resolution, fetch: offline }), resolution);
  for (const row of [{ ...resolution.targets[0], url: 'https://evil.invalid/runtime' },
    { ...resolution.targets[0], selectors: ['11.latest.latest'] }, { ...resolution.targets[0], id: 'wrong' },
    { ...resolution.targets[0], executable: '../escape' }, { ...resolution.targets[0], sha256: 'bad' }]) {
    await assert.rejects(resolveTargets(config, { resolution: { ...resolution, targets: [row] }, fetch: offline }));
  }
  await assert.rejects(resolveTargets(config, { resolution: { ...resolution, targets: [] }, fetch: offline }));
});

test('legacy pins resolve offline without changing their trusted names or hashes', async () => {
  const config = await loadConfig(await fixture()); assert.equal(config.schemaVersion, 1);
  if (config.schemaVersion !== 1) throw new Error('Expected legacy');
  const resolution = await resolveTargets(config, { fetch: async () => { throw new Error('No legacy HTTP'); } });
  assert.equal(resolution.targets[0].url, config.runtime.url);
  assert.equal(resolution.targets[0].sha256, config.runtime.sha256);
});

test('zero patch tag tries two-component official download only after 404 and retains actual native spelling', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.0', '10.0.latest'], platforms: ['linux-x64'] });
  const http = transport([['10.0.0']], url => url.includes('/10.0.0/') ? 404 : 200);
  const result = await resolveTargets(config, { fetch: http.fetch });
  assert.equal(result.targets.length, 1); assert.equal(result.targets[0].version, '10.0');
  assert.match(result.targets[0].url, /\/10\.0\/Zotero-10\.0_linux-x86_64.tar.xz$/);
  assert.equal(http.calls.filter(url => url.includes('download.zotero.org')).length, 2);
  const error = transport([['10.0.0']], () => 503);
  await assert.rejects(resolveTargets(config, { fetch: error.fetch }));
  assert.equal(error.calls.filter(url => url.includes('download.zotero.org')).length, 1);
});

test('Zotero 7 uses its official Linux bzip2 archive format', async () => {
  const { config } = await matrixFixture({ targets: ['7.latest.latest'], platforms: ['linux-x64'] });
  const result = await resolveTargets(config, { fetch: transport([['7.0.30']]).fetch });
  assert.match(result.targets[0].url, /Zotero-7.0.30_linux-x86_64.tar.bz2$/);
});

test('persists catalogue names and commits and verifies snapshot integrity on replay', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  const result = await resolveTargets(config, { fetch: transport([['10.0.8']]).fetch });
  assert.deepEqual(result.source.catalogue?.[0].tags, [{ name: '10.0.8', commit: 'a'.repeat(40) }]);
  const changed = structuredClone(result);
  assert.ok(changed.source.catalogue); changed.source.catalogue[0].tags[0].commit = 'b'.repeat(40);
  await assert.rejects(resolveTargets(config, { resolution: changed }));
  const missing = { ...result, source: { kind: result.source.kind, url: result.source.url, sha256: result.source.sha256 } };
  await assert.rejects(resolveTargets(config, { resolution: missing }));
});

test('accepts GitHub canonical repository ID pagination but rejects other repositories and origins', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  for (const next of ['https://api.github.com/repositories/2656556/tags?page=2&per_page=100',
    'https://api.github.com/repos/zotero/zotero/tags?per_page=100&page=2']) {
    const calls: string[] = [];
    const request: typeof fetch = async (input, init) => {
      if (!String(input).startsWith('https://api.github.com/') && !String(input).startsWith('https://download.zotero.org/')) {
        return transport([['10.0.7', '10.0.8']]).fetch(input, init);
      }
      const url = String(input); calls.push(url);
      if (calls.length === 1) return Response.json([{ name: '10.0.7', commit: { sha: 'a'.repeat(40) } }], { headers: { link: `<${next}>; rel="next"` } });
      if (calls.length === 2) { assert.equal(url, next); return Response.json([{ name: '10.0.8', commit: { sha: 'b'.repeat(40) } }]); }
      return new Response(null, { status: 200 });
    };
    assert.equal((await resolveTargets(config, { fetch: request })).targets[0].version, '10.0.8');
  }
  for (const next of ['https://evil.invalid/repositories/2656556/tags?per_page=100&page=2',
    'https://api.github.com/repositories/123/tags?per_page=100&page=2',
    'https://api.github.com/repos/other/zotero/tags?per_page=100&page=2']) {
    await assert.rejects(resolveTargets(config, { fetch: async () => Response.json([], { headers: { link: `<${next}>; rel="next"` } }) }));
  }
});

test('platform publication cap excludes newer tags before archive presence requests and is persisted', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  const http = transport([['10.0.9', '10.0.8']], url => url.includes('10.0.9') ? 403 : 200, { cap: '10.0.8' });
  const result = await resolveTargets(config, { fetch: http.fetch });
  assert.equal(result.targets[0].version, '10.0.8');
  assert.ok(!http.calls.some(url => url.includes('download.zotero.org') && url.includes('10.0.9')));
  assert.equal(result.source.platformVersions?.[0].version, '10.0.8');
  const changed = structuredClone(result); assert.ok(changed.source.platformVersions);
  changed.source.platformVersions[0].version = '10.0.9';
  await assert.rejects(resolveTargets(config, { resolution: changed }));
});

test('historical platform-only notices filter candidates without weakening HTTP 403 failures', async () => {
  const { config } = await matrixFixture({ targets: ['9.0.latest'], platforms: ['linux-x64', 'windows-x64'] });
  const current = '## Changes in 10.0 (date)\n\n- Change\n\n[View the 9.0 changelog](9.0_changelog)\n';
  const historical = '## Changes in 9.0.5 (date)\n\n*Zotero for Windows only*\n\n- Change\n## Changes in 9.0.4 (date)\n\n- Change\n';
  const base = transport([['9.0.5', '9.0.4']], url => url.includes('/9.0.5/') && url.includes('linux') ? 403 : 200,
    { cap: '10.0.8', changelog: current });
  const request: typeof fetch = async (input, init) => String(input).endsWith('/9.0_changelog.md') ? new Response(historical) : base.fetch(input, init);
  const result = await resolveTargets(config, { fetch: request });
  assert.deepEqual(result.targets.map(row => [row.platform, row.version]), [['linux-x64', '9.0.4'], ['windows-x64', '9.0.5']]);
  assert.equal(result.source.changelogs?.length, 2);
});

test('metadata errors, malformed scoped notices, and unqualified archive 403 remain actionable failures', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  for (const changelog of ['not a changelog', '## Changes in 10.0.8 (date)\n\n*Zotero for Plan9 only*\n']) {
    await assert.rejects(resolveTargets(config, { fetch: transport([['10.0.8']], () => 200, { changelog }).fetch }));
  }
  await assert.rejects(resolveTargets(config, { fetch: transport([['10.0.8']], () => 403).fetch }), /403.*10\.0\.8.*linux-x64/);
  const base = transport([['10.0.8']]);
  await assert.rejects(resolveTargets(config, { fetch: async (input, init) => String(input).includes('/download/client/version?')
    ? new Response(null, { status: 503 }) : base.fetch(input, init) }), /503/);
});

test('undated initial release headings admit the canonical zero-patch download alias', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.0'], platforms: ['linux-x64'] });
  const http = transport([['10.0.0']], url => url.includes('/10.0.0/') ? 404 : 200,
    { cap: '10.0', changelog: '## Changes in 10.0\n\n- Initial release\n' });
  assert.equal((await resolveTargets(config, { fetch: http.fetch })).targets[0].version, '10.0');
});

test('captures archived minors within the requested major even when the current heading covers that major', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.latest', '10.latest.latest'], platforms: ['linux-x64'] });
  const base = transport([['10.1.1', '10.0.8']], () => 200, { cap: '10.1.1',
    changelog: '## Changes in 10.1.1 (date)\n\n- Change\n\n[View the 10.0 changelog](10.0_changelog)\n' });
  const request: typeof fetch = async (input, init) => String(input).endsWith('/10.0_changelog.md')
    ? new Response('## Changes in 10.0.8 (date)\n\n- Change\n') : base.fetch(input, init);
  const result = await resolveTargets(config, { fetch: request });
  assert.deepEqual(result.targets.map(row => row.version), ['10.0.8', '10.1.1']);
  assert.equal(result.source.changelogs?.length, 2);
});

test('all platforms resolve baseline and undated new minor aliases from a complete same-major history chain', async () => {
  const { config } = await matrixFixture({ targets: ['10.0.latest', '10.latest.latest', '10.1.0'] });
  const current = '## Changes in 10.1\n\n- Initial release\n\n[View the 10.0 changelog](10.0_changelog)\n';
  const historical = '## Changes in 10.0.8 (date)\n\n- Change\n\n[View the 9.0 changelog](9.0_changelog)\n';
  const base = transport([['10.1.0', '10.0.8']], url => url.includes('/10.1.0/') ? 403 : 200,
    { cap: '10.1', changelog: current });
  const histories: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('_changelog.md')) { histories.push(url); assert.ok(url.endsWith('/10.0_changelog.md')); return new Response(historical); }
    return base.fetch(input, init);
  };
  const result = await resolveTargets(config, { fetch: request });
  assert.equal(result.targets.length, 6);
  for (const platform of config.platforms) {
    assert.deepEqual(result.targets.filter(row => row.platform === platform).map(row => [row.version, row.selectors]),
      [['10.0.8', ['10.0.latest']], ['10.1', ['10.latest.latest', '10.1.0']]]);
  }
  assert.equal(result.source.changelogs?.length, 2); assert.equal(histories.length, 1);
  assert.ok(!base.calls.some(url => url.includes('download.zotero.org') && url.includes('/10.1.0/')));
  assert.deepEqual(await resolveTargets(config, { resolution: result, fetch: async () => { throw new Error('Unexpected replay HTTP'); } }), result);
});

test('missing matching platform cap in captured tags fails before probing an older runtime', async () => {
  for (const selector of ['10.latest.latest', '10.0.latest']) {
    const { config } = await matrixFixture({ targets: [selector], platforms: ['linux-x64'] });
    const http = transport([['10.0.7']], () => 200, { cap: '10.0.8' });
    await assert.rejects(resolveTargets(config, { fetch: http.fetch }), /publication.*10\.0\.8.*absent.*catalogue/i);
    assert.ok(!http.calls.some(url => url.includes('download.zotero.org')));
  }
});

test('optional token reaches only scoped GitHub tag pages and is absent from saved metadata', async () => {
  const { config } = await matrixFixture({ platforms: ['linux-x64'] });
  for (const token of [undefined, 'fixture-readonly-token']) {
    const base = transport([['10.0.8']]), apiPaths: string[] = [];
    const next = 'https://api.github.com/repositories/2656556/tags?per_page=100&page=2';
    const request: typeof fetch = async (input, init) => {
      const url = new URL(String(input)), authorization = new Headers(init?.headers).get('authorization');
      if (url.origin === 'https://api.github.com') {
        assert.ok(['/repos/zotero/zotero/tags', '/repositories/2656556/tags'].includes(url.pathname));
        assert.equal(authorization, token ? `Bearer ${token}` : null); assert.equal(init?.redirect, 'error');
        apiPaths.push(url.pathname);
        if (url.pathname === '/repositories/2656556/tags') return Response.json([]);
        const response = await base.fetch(input, init); response.headers.set('link', `<${next}>; rel="next"`); return response;
      }
      assert.equal(authorization, null, 'Token leaked outside the GitHub tag catalogue');
      return base.fetch(input, init);
    };
    const result = await resolveTargets(config, { fetch: request, token });
    assert.equal(apiPaths.length, 2);
    assert.ok(!JSON.stringify(result).includes('fixture-readonly-token'));
  }
});

test('initial minor downloads use platform-cap or historical-heading spelling without probing the tag alias', async () => {
  const { config } = await matrixFixture({ targets: ['10.1.0', '10.1.latest'] });
  for (const cap of ['10.1', '10.2.1']) {
    const http = transport([['10.1.0']], url => {
      assert.ok(!url.includes('/10.1.0/'), 'Noncanonical zero-patch URL must never be probed');
      return 200;
    }, { cap, changelog: '## Changes in 10.2.1 (date)\n\n- Change\n## Changes in 10.1\n\n- Initial release\n' });
    const result = await resolveTargets(config, { fetch: http.fetch });
    assert.equal(result.targets.length, 3);
    assert.ok(result.targets.every(row => row.version === '10.1' && row.url.includes('/10.1/Zotero-10.1')));
    assert.equal(http.calls.filter(url => url.includes('download.zotero.org')).length, 3);
  }
});
