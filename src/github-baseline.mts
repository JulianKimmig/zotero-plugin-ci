/** Semantic release baseline selection and accepted previous-byte verification. */
import { createHash } from 'node:crypto';
import { versionParts } from './versions.mts';
/** Return the highest published stable version strictly before the target, ignoring creation order. */
export function selectBaseline<T extends { tag_name: string; draft: boolean; prerelease: boolean }>(releases: T[], version: string): T | undefined {
  const target = versionParts(version);
  /** Compare stable version tuples in descending order. */
  function compare(left: number[], right: number[]): number {
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return 0;
  }
  return releases.filter(item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name))
    .filter(item => compare(versionParts(item.tag_name.slice(1)), target) < 0)
    .sort((left, right) => compare(versionParts(right.tag_name.slice(1)), versionParts(left.tag_name.slice(1))))[0];
}
/** Require the previous archive bytes to match the corresponding published feed entry. */
export function verifyPreviousHash(bytes: Uint8Array, expected: string): void {
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== expected) throw new Error('Previous archive feed hash mismatch');
}
