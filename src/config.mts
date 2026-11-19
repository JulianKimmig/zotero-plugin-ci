/** Validate plugin-owned CI adapters before running package commands or exposing release metadata. */
import assert from 'node:assert/strict';
import { fields, text, relativeFile, https, readObject, containedFile, object } from './validation.mts';
import type { PluginConfig, Platform, Compatibility, CommonPluginConfig } from './contracts.mts';
import { nativeParts, parseCompatibility, targetSelector } from './native-versions.mts';

/** Validate the supported native platform enum. @param value External platform. @returns Typed platform. */
export function platform(value: unknown): Platform {
  assert.ok(value === 'linux-x64' || value === 'windows-x64' || value === 'macos-x64', 'Unsupported runtime platform');
  return value;
}

/** Return declared bounds for either configuration generation. @param config Admitted adapter. @returns Independent compatibility bounds. */
export function compatibilityFor(config: PluginConfig): Compatibility {
  return config.schemaVersion === 1 ? { min: config.runtime.version, max: config.runtime.version } : { ...config.compatibility };
}

/** Admit a nonempty unique list. @param value External array. @param parse Item admission function. @returns Typed items. */
function uniqueList<T>(value: unknown, parse: (item: unknown) => T): T[] {
  assert.ok(Array.isArray(value) && value.length > 0, 'Expected nonempty array');
  const result = value.map(parse); assert.equal(new Set(result).size, result.length, 'Duplicate configuration item'); return result;
}

/** Load a complete strict configuration and check actual declared npm scripts. @param root Plugin checkout. @param path Config path. @returns Validated CI adapter. */
export async function loadConfig(root: string, path = '.github/zotero-plugin.json'): Promise<PluginConfig> {
  const input = await readObject(root, path);
  assert.ok(input.schemaVersion === 1 || input.schemaVersion === 2, 'Unsupported CI configuration version');
  const raw = fields(input, ['schemaVersion', 'plugin', 'nodeVersion', 'versions', 'scripts', ...(input.schemaVersion === 1 ? ['runtime'] : ['compatibility', 'targets', 'platforms'])], ['bootstrap']);
  const plugin = fields(raw.plugin, ['id', 'slug']), versions = fields(raw.versions, ['package', 'lock', 'manifest']);
  const scripts = fields(raw.scripts, ['validate', 'build', 'native']);
  const common: CommonPluginConfig = {
    plugin: { id: text(plugin.id, /^[A-Za-z0-9_.@{}-]+$/), slug: text(plugin.slug, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/) },
    nodeVersion: text(raw.nodeVersion, /^\d+\.\d+\.\d+$/),
    versions: { package: relativeFile(versions.package), lock: relativeFile(versions.lock), manifest: relativeFile(versions.manifest) },
    scripts: { validate: text(scripts.validate, /^[a-zA-Z0-9:_-]+$/), build: text(scripts.build, /^[a-zA-Z0-9:_-]+$/), native: text(scripts.native, /^[a-zA-Z0-9:_-]+$/) },
  };
  let config: PluginConfig;
  if (raw.schemaVersion === 1) {
    const runtime = fields(raw.runtime, ['version', 'platform', 'url', 'sha256', 'executable']);
    assert.equal(runtime.platform, 'linux-x64', 'Only Linux x86_64 native CI is supported by schema v1');
    const version = text(runtime.version); nativeParts(version);
    config = { ...common, schemaVersion: 1, runtime: { version, platform: 'linux-x64', url: https(runtime.url),
      sha256: text(runtime.sha256, /^[a-f0-9]{64}$/), executable: relativeFile(runtime.executable) } };
  } else config = { ...common, schemaVersion: 2, compatibility: parseCompatibility(raw.compatibility),
    targets: uniqueList(raw.targets, targetSelector), platforms: uniqueList(raw.platforms, platform) };
  assert.equal(new Set(Object.values(config.versions)).size, 3, 'Version files must be distinct');
  for (const file of Object.values(config.versions)) await containedFile(root, file);
  const pkg = await readObject(root, config.versions.package), declared = object(pkg.scripts);
  for (const script of Object.values(config.scripts)) assert.ok(typeof declared[script] === 'string' && declared[script], `Missing npm script: ${script}`);
  if (raw.bootstrap !== undefined) {
    const bootstrap = fields(raw.bootstrap, ['version', 'commit']);
    config.bootstrap = { version: text(bootstrap.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/), commit: text(bootstrap.commit, /^[a-f0-9]{40}$/) };
  }
  return config;
}
