/** Platform archive validation and extraction into freshly owned runtime directories. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readdir, realpath, mkdtemp } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);

/** Reject path aliases, traversal, absolute names and Windows alternate streams before extracting a ZIP. */
export function validateZipListing(entries: readonly string[], verbose: string): void {
  assert.ok(entries.length > 0, 'Empty runtime ZIP');
  assert.ok(!/^l[rwxstST-]{9}\s/m.test(verbose), 'Refusing linked ZIP entry');
  const names = new Set<string>();
  for (const entry of entries) {
    const name = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    assert.ok(name && !/^[\/]/.test(name) && !/[\\:\x00-\x1f]/.test(name), 'Unsafe runtime ZIP path');
    assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Unsafe runtime ZIP component');
    const key = name.toLowerCase(); assert.ok(!names.has(key), 'Duplicate runtime ZIP path'); names.add(key);
  }
}

/** Require every app member, including resolved symbolic links, to remain within the application root. */
export async function validateApplicationTree(root: string): Promise<void> {
  const base = await realpath(root);
  /** Inspect one member without recursively following symbolic directories. @param path Absolute member. @returns Complete validated traversal. */
  async function inspect(path: string): Promise<void> {
    const stat = await lstat(path), actual = await realpath(path), suffix = relative(base, actual);
    assert.ok(!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../') && !suffix.startsWith('..\\'), 'Application link escapes outside root');
    if (stat.isSymbolicLink()) return;
    assert.ok(stat.isFile() || stat.isDirectory(), 'Special runtime application entry');
    if (stat.isDirectory()) for (const name of await readdir(path)) await inspect(join(path, name));
  }
  await inspect(resolve(root));
}

/** Extract a portable Windows ZIP after inspecting its complete central directory. */
export async function extractWindows(archive: string, destination: string): Promise<void> {
  const options = { encoding: 'utf8' as const, maxBuffer: 32 * 1024 * 1024 };
  const [{ stdout: listing }, { stdout: verbose }] = await Promise.all([
    exec('unzip', ['-Z1', archive], options), exec('unzip', ['-Z', '-l', archive], options),
  ]);
  validateZipListing(listing.trim().split('\n').map(line => line.replace(/\r$/, '')), verbose);
  await exec('unzip', ['-q', archive, '-d', destination], options);
}

/** Mount a macOS image read-only, validate and copy its application, and always detach the owned mount. */
export async function extractMac(archive: string, destination: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'zotero-dmg-')), mount = join(root, 'mount');
  await mkdir(mount);
  await exec('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, archive]);
  try {
    const source = join(mount, 'Zotero.app'); await validateApplicationTree(source);
    await exec('ditto', [source, join(destination, 'Zotero.app')]);
    await validateApplicationTree(join(destination, 'Zotero.app'));
  } finally { await exec('hdiutil', ['detach', mount]); }
}
