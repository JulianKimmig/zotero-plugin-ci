/** Validate plugin-owned CI adapters before running package commands or exposing release metadata. */
import assert from 'node:assert/strict';
import { fields, text, relativeFile, https, readObject, containedFile, object } from './validation.mts';
import type { PluginConfig } from './contracts.mts';

/** Load a complete strict configuration and check actual declared npm scripts. @param root Plugin checkout. @param path Config path. @returns Validated CI adapter. */
export async function loadConfig(root: string, path = '.github/zotero-plugin.json'): Promise<PluginConfig> {
  const raw = fields(await readObject(root, path), ['schemaVersion', 'plugin', 'nodeVersion', 'versions', 'scripts', 'runtime'], ['bootstrap']);
  assert.equal(raw.schemaVersion, 1, 'Unsupported CI configuration version');
  const plugin = fields(raw.plugin, ['id', 'slug']), versions = fields(raw.versions, ['package', 'lock', 'manifest']);
  const scripts = fields(raw.scripts, ['validate', 'build', 'native']);
  const runtime = fields(raw.runtime, ['version', 'platform', 'url', 'sha256', 'executable']);
  assert.equal(runtime.platform, 'linux-x64', 'Only Linux x86_64 native CI is supported');
  const config: PluginConfig = { schemaVersion: 1,
    plugin: { id: text(plugin.id, /^[A-Za-z0-9_.@{}-]+$/), slug: text(plugin.slug, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/) },
    nodeVersion: text(raw.nodeVersion, /^\d+\.\d+\.\d+$/),
    versions: { package: relativeFile(versions.package), lock: relativeFile(versions.lock), manifest: relativeFile(versions.manifest) },
    scripts: { validate: text(scripts.validate, /^[a-zA-Z0-9:_-]+$/), build: text(scripts.build, /^[a-zA-Z0-9:_-]+$/), native: text(scripts.native, /^[a-zA-Z0-9:_-]+$/) },
    runtime: { version: text(runtime.version, /^\d+\.\d+\.\d+$/), platform: 'linux-x64', url: https(runtime.url),
      sha256: text(runtime.sha256, /^[a-f0-9]{64}$/), executable: relativeFile(runtime.executable) },
  };
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
