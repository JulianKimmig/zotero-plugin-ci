/** Strict JSON input and filesystem containment guards for CI configuration and public metadata. */
import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

/** Admit an external JSON object. @param value Parsed external data. @returns Its string-keyed fields. */
export function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected JSON object');
  return value as Record<string, unknown>;
}

/** Require exact known fields. @param value JSON object. @param required Required names. @param optional Allowed optional names. @returns Validated object. */
export function fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const result = object(value);
  assert.ok(required.every(key => Object.hasOwn(result, key)), 'Missing required configuration fields');
  assert.ok(Object.keys(result).every(key => [...required, ...optional].includes(key)), 'Unknown configuration field');
  return result;
}

/** Require a matching nonempty string. @param value JSON scalar. @param pattern Permitted syntax. @returns Validated string. */
export function text(value: unknown, pattern: RegExp = /\S/): string {
  assert.ok(typeof value === 'string' && pattern.test(value), 'Invalid string value'); return value;
}

/** Admit portable relative file paths with no traversal or shell-dependent separators. @param value External path. @returns Relative path. */
export function relativeFile(value: unknown): string {
  const path = text(value, /^[A-Za-z0-9_.\-/]+$/);
  assert.ok(!isAbsolute(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe relative path');
  return path;
}

/** Require HTTPS without embedded credentials. @param value External URL. @returns Original URL. */
export function https(value: unknown): string {
  const raw = text(value), url = new URL(raw);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Expected credential-free HTTPS URL'); return raw;
}

/** Resolve a regular file without allowing any symlinked path component. @param root Checkout. @param path Portable relative path. @returns Canonical contained file. */
export async function containedFile(root: string, path: string): Promise<string> {
  const base = await realpath(root); let current = base;
  for (const part of relativeFile(path).split('/')) {
    current = join(current, part); assert.ok(!(await lstat(current)).isSymbolicLink(), 'Refusing symbolic link');
  }
  assert.ok((await lstat(current)).isFile(), 'Expected regular file');
  assert.equal(await realpath(current), resolve(base, path), 'File escaped checkout'); return current;
}

/** Parse only a contained regular JSON file. @param root Checkout root. @param path Relative input. @returns External object fields. */
export async function readObject(root: string, path: string): Promise<Record<string, unknown>> {
  return object(JSON.parse(await readFile(await containedFile(root, path), 'utf8')));
}
