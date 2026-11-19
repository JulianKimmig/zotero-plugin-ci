/** Download and extract a hash-pinned Linux runtime without touching user profiles. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, mkdtemp, readFile, access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { extractMac, extractWindows } from './runtime-archives.mts';
const exec = promisify(execFile);
/** Supported native matrix operating systems and CPU architecture. */
type Platform = 'linux-x64' | 'windows-x64' | 'macos-x64';
/** Download identity before its bytes have been observed. */
interface RuntimeDownload { version: string; platform: Platform; url: string; executable: string }

/** Require credential-free HTTPS download URLs before any network request. */
function downloadURL(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Runtime requires credential-free HTTPS');
}

/** Download one runtime exactly once and bind its immutable local archive to an observed SHA-256. */
export async function freezeRuntime(runtime: RuntimeDownload, archive: string): Promise<RuntimeDownload & { sha256: string }> {
  downloadURL(runtime.url);
  const response = await fetch(runtime.url);
  if (!response.ok) throw new Error(`Runtime download: ${response.status}`);
  downloadURL(response.url || runtime.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Empty runtime archive');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 });
  return { ...runtime, sha256 };
}
/** Require exact downloaded archive bytes to match the configured lowercase SHA256. */
export function verifyRuntimeHash(bytes: Uint8Array, expected: string): void {
  if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error('Runtime SHA256 mismatch');
  }
}
/** Validate GNU tar verbose entries; reject links, special files and escaping paths. */
export function validateTarListing(listing: string): void {
  const lines = listing.trim().split('\n');
  if (!listing.trim()) throw new Error('Empty runtime archive');
  for (const line of lines) {
    const match = /^([d-])[rwxStTs-]{9}\s+\S+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(line);
    const name = match?.[2];
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /[\x00-\x1f]/.test(name)) {
      throw new Error('Unsafe runtime tar entry');
    }
  }
}
/** Download a configured runtime into a fresh directory and return its executable path. */
export async function installRuntime(runtime: { url: string; sha256: string; executable: string; platform?: Platform }, destination: string, frozenArchive?: string): Promise<string> {
  downloadURL(runtime.url);
  if (isAbsolute(runtime.executable) || /[\\:\x00-\x1f]/.test(runtime.executable)
    || runtime.executable.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe runtime executable');
  let bytes: Buffer;
  if (frozenArchive) {
    const stat = await lstat(frozenArchive);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runtime archive must be a regular nonsymlink file');
    bytes = await readFile(frozenArchive);
  } else {
    const response = await fetch(runtime.url);
    if (!response.ok) throw new Error(`Runtime download: ${response.status}`);
    downloadURL(response.url || runtime.url);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyRuntimeHash(bytes, runtime.sha256);
  const platform = runtime.platform ?? 'linux-x64';
  const expected = { 'linux-x64': 'linux', 'windows-x64': 'win32', 'macos-x64': 'darwin' }[platform];
  if (process.platform !== expected || process.arch !== 'x64') throw new Error(`Runtime platform ${platform} does not match host`);
  const temporary = await mkdtemp(join(tmpdir(), 'zotero-runtime-'));
  const archive = join(temporary, platform === 'macos-x64' ? 'runtime.dmg' : platform === 'windows-x64' ? 'runtime.zip' : 'runtime.tar.xz');
  await writeFile(archive, bytes);
  await mkdir(destination, { recursive: false });
  if (platform === 'macos-x64') await extractMac(archive, destination);
  else if (platform === 'windows-x64') await extractWindows(archive, destination);
  else {
    const { stdout } = await exec('tar', ['-tvf', archive], { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 });
    validateTarListing(stdout);
    await exec('tar', ['-xf', archive, '--no-same-owner', '--no-same-permissions', '-C', destination]);
  }
  const executable = join(destination, runtime.executable), actual = await realpath(executable);
  const suffix = relative(await realpath(destination), actual);
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('../') || suffix.startsWith('..\\')) throw new Error('Runtime executable escapes installation');
  if (!(await lstat(actual)).isFile()) throw new Error('Runtime executable is not a regular file');
  await access(actual, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  return executable;
}
