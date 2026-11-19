/** Safe transport primitives for frozen pipeline metadata, byte identity and sanitized diagnostics. */
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
/** Read only a regular nonsymlink file; reject substituted transport inputs. */
export async function readRegular(path: string): Promise<Buffer> {
 const stat = await lstat(path);
 if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Pipeline input must be a regular file');
 return readFile(path);
}
/** Return the lowercase SHA-256 of the actual regular input file bytes. */
export async function hashFile(path: string): Promise<string> { return createHash('sha256').update(await readRegular(path)).digest('hex'); }
/** Parse transported JSON as unknown so each contract boundary admits its own structure. */
export async function readJSON(path: string): Promise<unknown> { return JSON.parse((await readRegular(path)).toString('utf8')) as unknown; }
/** Exclusively write a new JSON receipt, never overwriting an earlier phase's evidence. */
export async function writeJSON(path: string, value: object): Promise<void> { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
/** Redact explicit credentials/local roots and common credential forms from retained text. */
export function sanitizeLog(value: string, secrets: readonly string[], roots: readonly string[]): string {
 let clean = value;
 for (const secret of [...secrets, ...roots].filter(Boolean).sort((a, b) => b.length - a.length)) clean = clean.split(secret).join('[REDACTED]');
 return clean.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
  .replace(/([?&](?:token|key|secret|password|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED]')
  .replace(/::/g, ': :').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
/** Read receipts recursively without merging filenames or following directory symlinks. */
export async function readReceipts(directory: string): Promise<unknown[]> {
 const { readdir } = await import('node:fs/promises');
 const { join } = await import('node:path');
 const values: unknown[] = [];
 for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (entry.isSymbolicLink()) throw new Error('Receipt transport must not contain symlinks');
  const path = join(directory, entry.name);
  if (entry.isDirectory()) values.push(...await readReceipts(path));
  else if (entry.name.endsWith('.receipt.json')) values.push(await readJSON(path));
 }
 return values;
}
/** Sanitize only explicit diagnostic text, rejecting symlinks and accidental profile/database exports. */
export async function sanitizeDirectory(directory: string, secrets: readonly string[], roots: readonly string[]): Promise<void> {
 const { readdir } = await import('node:fs/promises');
 const { join } = await import('node:path');
 for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (entry.isSymbolicLink()) throw new Error('Diagnostics must not contain symlinks');
  const path = join(directory, entry.name);
  if (entry.isDirectory()) await sanitizeDirectory(path, secrets, roots);
  else {
   if (!entry.isFile() || !entry.name.endsWith('.log')) throw new Error('Only log files may be retained');
   await writeFile(path, sanitizeLog((await readRegular(path)).toString('utf8'), secrets, roots));
  }
 }
}
