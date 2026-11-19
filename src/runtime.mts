/** Download and extract a hash-pinned Linux runtime without touching user profiles. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);
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
export async function installRuntime(runtime: { url: string; sha256: string; executable: string }, destination: string): Promise<string> {
  if (new URL(runtime.url).protocol !== 'https:') throw new Error('Runtime requires HTTPS');
  if (runtime.executable.startsWith('/') || runtime.executable.split('/').includes('..')) throw new Error('Unsafe runtime executable');
  const response = await fetch(runtime.url);
  if (!response.ok) throw new Error(`Runtime download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyRuntimeHash(bytes, runtime.sha256);
  const temporary = await mkdtemp(join(tmpdir(), 'zotero-runtime-'));
  const archive = join(temporary, 'runtime.tar.xz');
  await writeFile(archive, bytes);
  const { stdout } = await exec('tar', ['-tvJf', archive], { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 });
  validateTarListing(stdout);
  await mkdir(destination, { recursive: false });
  await exec('tar', ['-xJf', archive, '--no-same-owner', '--no-same-permissions', '-C', destination]);
  return join(destination, runtime.executable);
}
