/** Inspect ZIP payloads without extraction and generate cumulative hash-bound Zotero update feeds. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { fields, text, object, https, relativeFile } from './validation.mts';
import { versionParts } from './versions.mts';
import { compatibilityFor } from './config.mts';
import { parseCompatibility } from './native-versions.mts';
import type { PluginConfig, ArtifactInfo, UpdateFeed, UpdateEntry } from './contracts.mts';

/** Compute a SHA-256 digest for exact supplied bytes. @param data Payload. @returns Lowercase hexadecimal digest. */
function hash(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }

/** Inspect immutable XPI file bytes and actual manifest identity/compatibility. @param xpi Archive path. @param config Adapter. @param expectedVersion Prepared version. @param options Historical mode admits the archive's own valid compatibility bounds; updateURL optionally requires an exact packaged discovery URL in either mode. @returns File set, compatibility, per-entry digests and archive identity. */
export async function inspectArtifact(xpi: string, config: PluginConfig, expectedVersion: string, options: { historical?: boolean; updateURL?: string } = {}): Promise<ArtifactInfo> {
  const stat = await lstat(xpi); assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'XPI must be a regular nonsymlink file');
  const sha256 = hash(await readFile(xpi));
  const listing = execFileSync('unzip', ['-Z', '-l', xpi], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.ok(!/^l[rwxstST-]{9}\s/m.test(listing), 'Refusing symbolic archive member');
  const entries = execFileSync('unzip', ['-Z1', xpi], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
  assert.equal(new Set(entries).size, entries.length, 'Duplicate archive paths');
  for (const entry of entries) relativeFile(entry.endsWith('/') ? entry.slice(0, -1) : entry);
  const files = entries.filter(entry => !entry.endsWith('/')).sort();
  assert.ok(files.includes('manifest.json') && files.includes('bootstrap.js') && files.includes('LICENSE'), 'Missing production or license inputs');
  assert.ok(files.every(path => !/(^|\/)(node_modules|\.build|\.git|credentials\.env|tests|scripts)(\/|$)/.test(path)), 'Development/private input in XPI');
  const digests: Record<string, string> = {};
  for (const path of files) digests[path] = hash(execFileSync('unzip', ['-p', xpi, path], { maxBuffer: 16 * 1024 * 1024 }));
  const manifest = object(JSON.parse(execFileSync('unzip', ['-p', xpi, 'manifest.json'], { encoding: 'utf8' })));
  const native = object(object(manifest.applications).zotero);
  versionParts(expectedVersion); assert.equal(manifest.version, expectedVersion, 'Packaged version mismatch');
  assert.equal(native.id, config.plugin.id, 'Packaged plugin identity mismatch');
  const compatibility = parseCompatibility({ min: native.strict_min_version, max: native.strict_max_version });
  if (!options.historical) assert.deepEqual(compatibility, compatibilityFor(config), 'Unsupported packaged compatibility bounds');
  https(native.update_url);
  if (options.updateURL !== undefined) assert.equal(native.update_url, options.updateURL, 'Packaged update URL mismatch');
  assert.equal(hash(await readFile(xpi)), sha256, 'Archive mutated during inspection');
  return { sha256, version: expectedVersion, files, entries: digests, id: config.plugin.id, compatibility };
}

/** Parse one complete update entry without trusting previously downloaded metadata. @param value External entry. @returns Validated detached entry. */
function updateEntry(value: unknown): UpdateEntry {
  const entry = fields(value, ['version', 'update_link', 'update_hash', 'applications']);
  const version = text(entry.version); versionParts(version);
  const native = fields(fields(entry.applications, ['zotero']).zotero, ['strict_min_version', 'strict_max_version']);
  return { version, update_link: https(entry.update_link), update_hash: text(entry.update_hash, /^sha256:[a-f0-9]{64}$/),
    applications: { zotero: { strict_min_version: text(native.strict_min_version), strict_max_version: text(native.strict_max_version) } } };
}

/** Extend the previous feed, refusing conflicting duplicate versions and identity mismatches. @param config Adapter. @param version Release version. @param sha256 Archive digest. @param repo owner/name. @param previousFeed External previous feed, null only for bootstrap. @returns Complete Zotero JSON feed. */
export function createUpdateFeed(config: PluginConfig, version: string, sha256: string, repo: string, previousFeed: unknown): UpdateFeed {
  versionParts(version); assert.match(sha256, /^[a-f0-9]{64}$/); assert.match(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  let updates: UpdateEntry[] = [];
  if (previousFeed !== null) {
    const addons = fields(fields(previousFeed, ['addons']).addons, [config.plugin.id]);
    const previous = fields(addons[config.plugin.id], ['updates']); assert.ok(Array.isArray(previous.updates), 'Expected update array');
    updates = previous.updates.map(updateEntry);
    assert.equal(new Set(updates.map(entry => entry.version)).size, updates.length, 'Duplicate historical update version');
  }
  const compatibility = compatibilityFor(config);
  const entry: UpdateEntry = { version, update_link: `https://github.com/${repo}/releases/download/v${version}/${config.plugin.slug}-${version}.xpi`,
    update_hash: `sha256:${sha256}`, applications: { zotero: { strict_min_version: compatibility.min, strict_max_version: compatibility.max } } };
  const existing = updates.find(update => update.version === version);
  const target = versionParts(version);
  for (const update of updates) {
    const prior = versionParts(update.version);
    const order = prior.findIndex((part, index) => part !== target[index]);
    assert.ok(order < 0 || prior[order] < target[order], 'Update feed cannot regress to an older version');
  }
  if (existing) assert.deepEqual(existing, entry, 'Existing update version conflicts with release');
  else updates.push(entry);
  return { addons: { [config.plugin.id]: { updates } } };
}
