/** Real filesystem/ZIP fixtures for the shared automation contract. */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Create an isolated plugin with declared scripts and three matching versions. @returns Fresh plugin root. */
export async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zotero-ci-core-'));
  await mkdir(join(root, '.github'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'example', version: '0.1.0', scripts: {
    'ci:validate': 'node check.mjs', 'ci:build': 'node build.mjs', 'ci:native': 'node native.mjs',
  } }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', lockfileVersion: 3,
    packages: { '': { version: '0.1.0' } } }));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ manifest_version: 2, version: '0.1.0', applications: {
    zotero: { id: 'example@test', strict_min_version: '10.0.7', strict_max_version: '10.0.7',
      update_url: 'https://github.com/example/plugin/releases/latest/download/updates.json' },
  } }));
  await writeFile(join(root, '.github/zotero-plugin.json'), JSON.stringify({ schemaVersion: 1,
    plugin: { id: 'example@test', slug: 'example' }, nodeVersion: '22.17.0',
    versions: { package: 'package.json', lock: 'package-lock.json', manifest: 'manifest.json' },
    scripts: { validate: 'ci:validate', build: 'ci:build', native: 'ci:native' },
    runtime: { version: '10.0.7', platform: 'linux-x64', url: 'https://example.org/zotero.tar.xz',
      sha256: 'a'.repeat(64), executable: 'Zotero_linux-x86_64/zotero' },
  }));
  return root;
}

/** Archive real manifest/code/legal inputs, allowing additional malicious path names. @param root Fixture root. @returns XPI path. */
export async function archive(root: string): Promise<string> {
  await writeFile(join(root, 'bootstrap.js'), '/** Example native bootstrap. */\n');
  await writeFile(join(root, 'LICENSE'), 'MIT fixture\n');
  const output = join(root, 'plugin.xpi');
  execFileSync('zip', ['-q', '-X', output, 'manifest.json', 'bootstrap.js', 'LICENSE'], { cwd: root });
  return output;
}
