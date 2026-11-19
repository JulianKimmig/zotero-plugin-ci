/** Portable admission for explicitly declared generated native tools, excluding private runtime state. */
import assert from 'node:assert/strict';
import { relativeFile } from './validation.mts';
/** Admit one project-relative generated path without dependency, credential or profile components. */
export function nativeToolPath(value: unknown): string {
 const path = relativeFile(value);
 const forbidden = /^(?:node_modules|\.git|\.aws|\.ssh|\.gnupg|\.mozilla|\.zotero|\.config|profiles?|zotero|\.env(?:\..*)?|credentials(?:\.env|\.json)?|.+\.(?:pem|key|sqlite)(?:-shm|-wal)?)$/i;
 assert.ok(path.split('/').every(part => !forbidden.test(part)), 'Forbidden native tools path');
 return path;
}
/** Admit an explicit list, allowing no tools while rejecting duplicates and overlapping transport roots. */
export function nativeToolPaths(value: unknown): string[] {
 assert.ok(Array.isArray(value), 'nativeTools must be an array');
 const paths = value.map(nativeToolPath), portable = paths.map(path => path.toLowerCase());
 assert.equal(new Set(portable).size, paths.length, 'Duplicate native tools path');
 assert.ok(portable.every((path, index) => portable.every((other, otherIndex) => index === otherIndex || !path.startsWith(other + '/'))), 'Overlapping native tools paths');
 return paths;
}
