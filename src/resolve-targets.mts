/** Resolve selectors once into replayable native matrix rows, without downloading runtime bytes. */
import assert from 'node:assert/strict';
import { fields, text } from './validation.mts';
import { platform } from './config.mts';
import { compareNative, nativeParts, matchesSelector, targetSelector } from './native-versions.mts';
import { captureCatalogue, catalogueSnapshot, officialRuntime, CATALOGUE_URL, identityHash } from './target-catalogue.mts';
import { availabilitySnapshot, captureAvailability, platformEligible, releaseSpelling } from './release-availability.mts';
import type { PluginConfig, PlatformVersion, Resolution, ResolvedTarget, ResolutionSource } from './contracts.mts';

/** Optional external HTTP/clock dependencies, tag-catalogue-only GitHub token, or resolution to validate offline. */
export interface ResolveOptions { fetch?: typeof fetch; now?: () => Date; resolution?: unknown; token?: string }

/** Construct the single immutable legacy row without HTTP. @param config Legacy config. @returns Replayable row. */
function legacyRow(config: Extract<PluginConfig, { schemaVersion: 1 }>): ResolvedTarget {
  const runtime = config.runtime;
  return { ...runtime, id: `${runtime.version}-${runtime.platform}`, selectors: [runtime.version] };
}

/** Refuse an older result when requested publication metadata has raced ahead of the tag capture. @param versions Captured tag names. @param selectors Requested selectors. @param caps Official platform publication observations. @returns Completion only when every matching cap has stable tag provenance. */
function assertCapProvenance(versions: string[], selectors: string[], caps: PlatformVersion[]): void {
  const stable = versions.filter(version => /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(version));
  for (const cap of caps) if (selectors.some(selector => matchesSelector(selector, cap.version))) {
    assert.ok(stable.some(version => compareNative(version, cap.version) === 0),
      `Platform publication ${cap.version}/${cap.platform} absent from captured tag catalogue; retry resolution after metadata converges`);
  }
}

/** Validate detached replay metadata, rows and full selector/platform coverage. @param value External resolution. @param config Current config. @returns Validated replay. */
export function validateResolution(value: unknown, config: PluginConfig): Resolution {
  const raw = fields(value, ['schemaVersion', 'resolvedAt', 'source', 'targets']);
  assert.equal(raw.schemaVersion, 1, 'Unsupported resolution version');
  const resolvedAt = text(raw.resolvedAt);
  assert.ok(Number.isFinite(Date.parse(resolvedAt)) && new Date(resolvedAt).toISOString() === resolvedAt, 'Invalid resolution timestamp');
  const sourceRaw = fields(raw.source, ['kind', 'url', 'sha256'], config.schemaVersion === 2 ? ['catalogue', 'platformVersions', 'changelogs'] : []);
  assert.equal(sourceRaw.kind, config.schemaVersion === 1 ? 'legacy-pin' : 'zotero-tags');
  const source: ResolutionSource = { kind: sourceRaw.kind as ResolutionSource['kind'], url: text(sourceRaw.url), sha256: text(sourceRaw.sha256, /^[a-f0-9]{64}$/) };
  assert.equal(source.url, config.schemaVersion === 1 ? config.runtime.url : CATALOGUE_URL);
  if (config.schemaVersion === 2) {
    source.catalogue = catalogueSnapshot(sourceRaw.catalogue);
    Object.assign(source, availabilitySnapshot(sourceRaw.platformVersions, sourceRaw.changelogs, config.platforms));
    assert.ok(source.platformVersions);
    assertCapProvenance(source.catalogue.flatMap(page => page.tags.map(tag => tag.name)), config.targets, source.platformVersions);
    assert.equal(source.sha256, identityHash({ catalogue: source.catalogue, platformVersions: source.platformVersions, changelogs: source.changelogs }), 'Captured catalogue identity mismatch');
  }
  assert.ok(Array.isArray(raw.targets) && raw.targets.length > 0, 'Expected resolved targets');
  const targets: ResolvedTarget[] = raw.targets.map(value => {
    const row = fields(value, ['id', 'selectors', 'version', 'platform', 'url', 'executable'], ['sha256']);
    const version = text(row.version); nativeParts(version);
    const os = platform(row.platform), id = text(row.id), url = text(row.url), executable = text(row.executable);
    assert.equal(id, `${version}-${os}`, 'Invalid target ID');
    assert.ok(Array.isArray(row.selectors) && row.selectors.length > 0);
    const selectors = row.selectors.map(targetSelector); assert.equal(new Set(selectors).size, selectors.length);
    const result: ResolvedTarget = { id, selectors, version, platform: os, url, executable };
    if (row.sha256 !== undefined) result.sha256 = text(row.sha256, /^[a-f0-9]{64}$/);
    if (config.schemaVersion === 1) assert.deepEqual(result, legacyRow(config), 'Legacy pin changed');
    else {
      assert.ok(config.platforms.includes(os), 'Unexpected matrix platform');
      assert.deepEqual({ url, executable }, officialRuntime(version, os), 'Nonofficial runtime location');
      assert.ok(source.platformVersions && source.changelogs);
      assert.ok(platformEligible(version, os, { platformVersions: source.platformVersions, changelogs: source.changelogs }), 'Release excluded by captured platform metadata');
      assert.ok(selectors.every(selector => config.targets.includes(selector) && matchesSelector(selector, version)), 'Unexpected selector resolution');
      assert.ok(source.catalogue?.some(page => page.tags.some(tag =>
        tag.name === version || (tag.name.endsWith('.0') && tag.name.slice(0, -2) === version))), 'Resolved release absent from captured catalogue');
    }
    return result;
  });
  assert.equal(new Set(targets.map(row => row.id)).size, targets.length, 'Duplicate resolved targets');
  if (config.schemaVersion === 1) {
    assert.equal(targets.length, 1); assert.equal(source.sha256, identityHash(config.runtime), 'Legacy source identity changed');
  } else {
    for (const selector of config.targets) for (const os of config.platforms) {
      assert.equal(targets.filter(row => row.platform === os && row.selectors.includes(selector)).length, 1, 'Missing or ambiguous selector/platform resolution');
    }
  }
  return { schemaVersion: 1, resolvedAt, source, targets };
}

/** Resolve each requested selector/platform from one official catalogue; only archive 404 permits trying an older candidate. @param config Admitted adapter. @param options HTTP/clock overrides or deterministic replay. @returns Validated matrix resolution with original native release spelling. */
export async function resolveTargets(config: PluginConfig, options: ResolveOptions = {}): Promise<Resolution> {
  if (options.resolution !== undefined) return validateResolution(options.resolution, config);
  const resolvedAt = (options.now ?? (() => new Date()))().toISOString();
  if (config.schemaVersion === 1) return validateResolution({ schemaVersion: 1, resolvedAt,
    source: { kind: 'legacy-pin', url: config.runtime.url, sha256: identityHash(config.runtime) }, targets: [legacyRow(config)] }, config);
  const request = options.fetch ?? fetch, catalogue = await captureCatalogue(request, options.token);
  const evidence = await captureAvailability(request, config.platforms, [...new Set(config.targets.map(selector => Number(selector.split('.')[0])))]);
  assertCapProvenance(catalogue.versions, config.targets, evidence.platformVersions);
  Object.assign(catalogue.source, evidence);
  catalogue.source.sha256 = identityHash({ catalogue: catalogue.source.catalogue, ...evidence });
  const rows = new Map<string, ResolvedTarget>(), available = new Map<string, boolean>();
  for (const selector of config.targets) for (const os of config.platforms) {
    const candidates = catalogue.versions.filter(version => matchesSelector(selector, version));
    let selected: ResolvedTarget | undefined;
    for (const tag of candidates) {
      if (!platformEligible(tag, os, evidence)) continue;
      const published = releaseSpelling(tag, os, evidence);
      const spellings = published.split('.').length === 3 && published.endsWith('.0') ? [published, published.slice(0, -2)] : [published];
      for (const version of spellings) {
        const runtime = officialRuntime(version, os), id = `${version}-${os}`;
        if (!available.has(id)) {
          const response = await request(runtime.url, { method: 'HEAD', redirect: 'error' });
          assert.ok(response.ok || response.status === 404, `Runtime presence HTTP ${response.status} for ${version}/${os}; availability is unconfirmed, inspect official platform metadata before retrying`);
          available.set(id, response.ok);
        }
        if (!available.get(id)) continue;
        selected = rows.get(id) ?? { id, selectors: [], version, platform: os, ...runtime };
        selected.selectors.push(selector); rows.set(id, selected); break;
      }
      if (selected) break;
    }
    assert.ok(selected, `No official runtime for ${selector}/${os}`);
  }
  return validateResolution({ schemaVersion: 1, resolvedAt, source: catalogue.source, targets: [...rows.values()] }, config);
}
