/** Deterministic semantic release calculation and idempotent three-file source preparation. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { object, readObject, text, containedFile } from './validation.mts';
import type { PluginConfig } from './contracts.mts';

/** Parse standard stable semantic versions with safe integer components. @param value Candidate version. @returns Major/minor/patch. */
export function versionParts(value: string): [number, number, number] {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected stable semantic version');
  const parts = value.split('.').map(Number); assert.ok(parts.every(Number.isSafeInteger), 'Unsafe version component');
  return [parts[0], parts[1], parts[2]];
}

/** Require an actual semantic upgrade before building a bootstrap or claiming native upgrade proof. @param previous Prior stable version. @param current New stable version. @returns Completion only for a strictly older predecessor. */
export function assertPredecessor(previous: string, current: string): void {
  const before = versionParts(previous), after = versionParts(current);
  const index = before.findIndex((value, position) => value !== after[position]);
  assert.ok(index >= 0 && before[index] < after[index], 'Upgrade requires a strictly older predecessor');
}

/** Calculate the selected bump, requiring at most one recognized release label. @param base Latest baseline. @param labels PR labels. @returns Next stable version. */
export function nextVersion(base: string, labels: readonly string[]): string {
  const parts = versionParts(base), selected = labels.filter(label => label.startsWith('release:'));
  assert.ok(selected.length <= 1 && selected.every(label => ['release:patch', 'release:minor', 'release:major'].includes(label)), 'Conflicting or unsupported release labels');
  const index = selected[0] === 'release:major' ? 0 : selected[0] === 'release:minor' ? 1 : 2;
  parts[index]++; for (let i = index + 1; i < 3; i++) parts[i] = 0;
  assert.ok(parts.every(Number.isSafeInteger), 'Version overflow'); return parts.join('.');
}

/** Require every version location and addon identity to agree. @param root Checkout. @param config Validated adapter. @returns Stable source version. */
export async function readVersion(root: string, config: PluginConfig): Promise<string> {
  const pkg = await readObject(root, config.versions.package), lock = await readObject(root, config.versions.lock), manifest = await readObject(root, config.versions.manifest);
  const version = text(pkg.version); versionParts(version);
  assert.equal(lock.version, version, 'Lock root version mismatch');
  assert.equal(object(object(lock.packages)['']).version, version, 'Lock package version mismatch');
  assert.equal(manifest.version, version, 'Manifest version mismatch');
  assert.equal(object(object(manifest.applications).zotero).id, config.plugin.id, 'Manifest plugin identity mismatch');
  return version;
}

/** Update all version locations only after complete input validation. @param root Checkout. @param config Adapter. @param target Stable next version. @returns Changed relative paths, empty on retry. */
export async function prepareVersions(root: string, config: PluginConfig, target: string): Promise<string[]> {
  versionParts(target); const current = await readVersion(root, config); if (current === target) return [];
  const changes: { path: string; full: string; data: string }[] = [];
  for (const [kind, path] of Object.entries(config.versions)) {
    const full = await containedFile(root, path), raw = await readFile(full, 'utf8'), value = object(JSON.parse(raw));
    value.version = target;
    if (kind === 'lock') object(object(value.packages)['']).version = target;
    const indentation = raw.match(/\n([ \t]+)"/)?.[1] ?? '  ';
    changes.push({ path, full, data: JSON.stringify(value, null, indentation) + '\n' });
  }
  for (const change of changes) await writeFile(change.full, change.data);
  return changes.map(change => change.path);
}
