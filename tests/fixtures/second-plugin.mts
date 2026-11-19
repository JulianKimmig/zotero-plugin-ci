/** Materialize an independent local plugin fixture; its repository/runtime URLs are never fetched. */
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Create an isolated second plugin with actual production files and runnable build/check commands. @returns Absolute fresh plugin checkout path. */
export async function secondPlugin(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zotero-ci-second-plugin-'));
  await cp(new URL('./citation-lantern/', import.meta.url), root, { recursive: true });
  await mkdir(join(root, '.github'));
  const version = '2.4.6';
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'citation-lantern', version, private: true, type: 'module', scripts: {
    'fixture:check': 'node --experimental-strip-types tools/check.mts',
    'fixture:pack': 'node --experimental-strip-types tools/pack.mts',
    'fixture:native': 'node --experimental-strip-types tools/native.mts',
  } }, null, 2));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'citation-lantern', version,
    lockfileVersion: 3, packages: { '': { name: 'citation-lantern', version } } }, null, 2));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Citation Lantern', version,
    applications: { zotero: { id: 'citation-lantern@fixtures.invalid', strict_min_version: '10.0.7', strict_max_version: '10.0.7',
      update_url: 'https://github.com/fixture-owner/citation-lantern/releases/latest/download/updates.json' } } }, null, 2));
  await writeFile(join(root, '.github/zotero-plugin.json'), JSON.stringify({ schemaVersion: 1,
    plugin: { id: 'citation-lantern@fixtures.invalid', slug: 'citation-lantern' }, nodeVersion: '22.17.0',
    versions: { package: 'package.json', lock: 'package-lock.json', manifest: 'manifest.json' },
    scripts: { validate: 'fixture:check', build: 'fixture:pack', native: 'fixture:native' },
    runtime: { version: '10.0.7', platform: 'linux-x64', url: 'https://fixtures.invalid/zotero-10.0.7.tar.xz',
      sha256: 'c'.repeat(64), executable: 'Zotero_linux-x86_64/zotero' },
  }, null, 2));
  return root;
}
